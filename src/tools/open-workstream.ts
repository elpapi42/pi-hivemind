import { defineTool } from "@earendil-works/pi-durable";
import { IndexDoc, openWorkstream } from "../board.ts";
import { LIMITS, type HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { searchTitles } from "../search.ts";
import { OPEN_WORKSTREAM_OUTPUT } from "./schemas.ts";
import { failure, firstReason, parameters, result, tooLong, toText } from "./shared.ts";

export const OPEN_WORKSTREAM_TOOL = "hivemind_open_workstream";

/** How many open workstreams with a similar title the answer names, so a duplicate is noticed at once. */
const SIMILAR_SHOWN = 3;

export function openWorkstreamTool(config: HivemindConfig) {
  return defineTool({
    name: OPEN_WORKSTREAM_TOOL,
    description: TOOL_DESCRIPTIONS.openWorkstream,
    parameters: parameters({
      title: { type: "string", description: "Short and stable name of the work." },
      description: { type: "string", description: "The current state: the goal, where it stands, what is next or blocking." },
      involvement: { type: "string", description: "This conversation's part: what it is responsible for, who it works with and where." },
    }),
    structuredOutputSchema: OPEN_WORKSTREAM_OUTPUT,
    executionMode: "sequential",
    execute: async (args, api, context) => {
      const refuse = (error: string) => failure(error, { similar: [] });
      const input = args as { title?: unknown; description?: unknown; involvement?: unknown };
      const self = api.conversationId as number;
      const title = toText(input.title)?.replace(/\s+/g, " ");
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
        const similar = searchTitles(Object.values((await tx.doc(IndexDoc)).open), title)
          .slice(0, SIMILAR_SHOWN)
          .map((row) => ({ id: ref(row.id), title: row.title }));
        const workstream = await openWorkstream(tx, config, { title, description, involvement, by: self, at: api.now() });
        return { id: workstream.id, similar };
      }, context);

      const note =
        opened.similar.length === 0
          ? ""
          : `\n\nOpen workstreams with similar titles:\n${opened.similar.map((row) => `- ${row.id} · ${row.title}`).join("\n")}\nIf one of them is the same work, mark ${ref(opened.id)} done with an outcome that names it, and join that one instead.`;
      return result(`Opened ${ref(opened.id)} · ${title}. You are recorded as involved.${note}`, { id: ref(opened.id), similar: opened.similar });
    },
  });
}
