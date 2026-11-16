import { defineTool } from "@earendil-works/pi-durable";
import { IndexDoc, openWorkstream } from "../board.ts";
import { LIMITS } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { search } from "../search.ts";
import { answer, firstReason, parameters, refuse, tooLong, toText } from "./shared.ts";

export const OPEN_TOOL = "hivemind_open";

/** How many open workstreams with a similar title the answer names, so a duplicate is noticed at once. */
const SIMILAR_SHOWN = 3;

export function openTool() {
  return defineTool({
    name: OPEN_TOOL,
    description: TOOL_DESCRIPTIONS.open,
    parameters: parameters({
      title: { type: "string", description: "Short and stable name of the work." },
      description: { type: "string", description: "The current state: the goal, where it stands, what is next or blocking." },
      involvement: { type: "string", description: "This conversation's part: what it is responsible for, who it works with and where." },
    }),
    executionMode: "sequential",
    execute: async (args, api, context) => {
      const input = args as { title?: unknown; description?: unknown; involvement?: unknown };
      const self = api.conversationId as number;
      const title = toText(input.title);
      const description = toText(input.description);
      const involvement = toText(input.involvement);
      if (title === undefined || description === undefined || involvement === undefined) {
        return refuse("`title`, `description` and `involvement` are all needed, and none may be empty.");
      }
      const reason = firstReason(
        tooLong("title", title, LIMITS.title),
        tooLong("description", description, LIMITS.description),
        tooLong("involvement", involvement, LIMITS.involvement),
      );
      if (reason !== undefined) return refuse(reason);

      const opened = await api.commit(async (tx) => {
        const others = Object.values((await tx.doc(IndexDoc)).rows).filter((row) => row.status === "open");
        const similar = search(others, title)
          .slice(0, SIMILAR_SHOWN)
          .map((row) => `${ref(row.id)} · ${row.title}`);
        const workstream = await openWorkstream(tx, { title, description, involvement, by: self, at: api.now() });
        return { id: workstream.id, similar };
      }, context);

      const note =
        opened.similar.length === 0
          ? ""
          : `\n\nOpen workstreams with similar titles:\n${opened.similar.map((line) => `- ${line}`).join("\n")}\nIf one of them is the same work, mark ${ref(opened.id)} done with a summary that names it, and join that one instead.`;
      return answer(self, `Opened ${ref(opened.id)} · ${title}. You are recorded as involved.${note}`);
    },
  });
}
