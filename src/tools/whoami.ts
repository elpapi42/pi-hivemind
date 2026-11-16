import { defineTool } from "@earendil-works/pi-durable";
import { IndexDoc, WorkstreamDoc, type IndexRow } from "../board.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { WHOAMI_OUTPUT } from "./schemas.ts";
import { parameters, result } from "./shared.ts";

export const WHOAMI_TOOL = "hivemind_whoami";

/** The workstreams a conversation is involved in, open ones first, each newest first. */
const involving = (rows: readonly IndexRow[], conversation: number): IndexRow[] =>
  rows
    .filter((row) => row.involved.includes(conversation))
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.updatedAt - a.updatedAt);

const line = (row: IndexRow): string => `- ${ref(row.id)} · ${row.title} · ${row.status}`;

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
      const rows = Object.values((await api.snapshot(IndexDoc, context))?.rows ?? {});
      const origin = record?.parent?.conversationId as number | undefined;

      /** The workstreams with the conversation's own account of its part, which only the workstream itself holds. */
      const parts = async (conversation: number) =>
        Promise.all(
          involving(rows, conversation).map(async (row) => {
            const workstream = await api.snapshot(WorkstreamDoc, String(row.id), context);
            return { id: ref(row.id), title: row.title, status: row.status, part: workstream?.involved[String(conversation)]?.text ?? "" };
          }),
        );

      const own = involving(rows, self);
      const lines = [`You are conversation ${self}.`];
      if (origin !== undefined) {
        lines.push(
          `This conversation started as a copy of conversation ${origin}. What you remember from before the copy was done by conversation ${origin}, and the blackboard records it under ${origin}, not under you.`,
        );
      }
      lines.push("", own.length === 0 ? "You are not involved in any workstream." : `You are involved in ${own.length === 1 ? "this workstream" : "these workstreams"}:`, ...own.map(line));
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
