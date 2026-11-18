import { defineTool } from "@earendil-works/pi-durable";
import type { OpenRow } from "../board.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { WHOAMI_OUTPUT } from "./schemas.ts";
import { parameters, result, sourceOf } from "./shared.ts";

export const WHOAMI_TOOL = "hivemind_whoami";

/** The open workstreams a conversation is involved in, most recently changed first. */
const involving = (rows: readonly OpenRow[], conversation: number): OpenRow[] => rows.filter((row) => row.involved.includes(conversation)).sort((a, b) => b.updatedAt - a.updatedAt);

const line = (row: OpenRow): string => `- ${ref(row.id)} · ${row.title}`;

/**
 * The only place a conversation learns its id. No answer of the other tools states it in text, and the prompt section
 * cannot: a fork must be sent the same system prompt as its parent to read the parent's provider cache. A fork also
 * starts with its parent's context, so an id read earlier may be the parent's; this tool always answers for the caller.
 */
export function whoamiTool() {
  return defineTool({
    name: WHOAMI_TOOL,
    description: TOOL_DESCRIPTIONS.whoami,
    parameters: parameters({}),
    structuredOutputSchema: WHOAMI_OUTPUT,
    replay: "safe",
    execute: async (_args, api, context) => {
      const self = api.conversationId as number;
      const record = await api.commit((tx) => tx.conversation(api.conversationId), context);
      const source = sourceOf(api, context);
      const rows = Object.values((await source.index())?.open ?? {});
      const origin = record?.parent?.conversationId as number | undefined;

      /** The workstreams with the conversation's own account of its part, which only the workstream itself holds. */
      const parts = async (conversation: number) =>
        Promise.all(
          involving(rows, conversation).map(async (row) => ({
            id: ref(row.id),
            title: row.title,
            part: (await source.workstream(row.id))?.involved[String(conversation)]?.text ?? "",
          })),
        );

      const own = involving(rows, self);
      const lines = [`You are conversation ${self}.`];
      if (origin !== undefined) {
        lines.push(
          `This conversation started as a copy of conversation ${origin}. What you remember from before the copy was done by conversation ${origin}, and the log and the workstreams record it under ${origin}, not under you.`,
        );
      }
      lines.push("", own.length === 0 ? "You are not involved in any open workstream." : `You are involved in ${own.length === 1 ? "this open workstream" : "these open workstreams"}:`, ...own.map(line));
      const theirs = origin === undefined ? [] : involving(rows, origin);
      if (origin !== undefined && theirs.length > 0) lines.push("", `Conversation ${origin} is involved in:`, ...theirs.map(line));

      return result(lines.join("\n"), {
        you: self,
        workstreams: await parts(self),
        ...(origin === undefined ? {} : { copyOf: origin, copyOfWorkstreams: await parts(origin) }),
      });
    },
  });
}
