import { defineTool } from "@earendil-works/pi-durable";
import { IndexDoc, type IndexRow, type Status } from "../board.ts";
import type { HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { rowText } from "../render.ts";
import { search } from "../search.ts";
import { answer, parameters, refuse, toConversationId, toText } from "./shared.ts";

export const LIST_TOOL = "hivemind_list";

type Filter = Status | "all";

const describeFilter = (filter: Filter, conversation: number | undefined): string =>
  `${filter === "all" ? "" : `${filter} `}workstreams${conversation === undefined ? "" : ` that involve conversation ${conversation}`}`;

export function listTool(config: HivemindConfig) {
  return defineTool({
    name: LIST_TOOL,
    description: TOOL_DESCRIPTIONS.list,
    parameters: parameters(
      {
        query: { type: "string", description: "Words to search for. Searches all workstreams unless `status` narrows it." },
        status: { type: "string", enum: ["open", "done", "all"], description: 'Default: "open", or "all" when `query` is given.' },
        conversation: { type: "integer", description: "Keep only the workstreams this conversation is involved in." },
      },
      ["query", "status", "conversation"],
    ),
    replay: "safe",
    execute: async (args, api, context) => {
      const input = args as { query?: unknown; status?: unknown; conversation?: unknown };
      const self = api.conversationId as number;
      const query = toText(input.query);
      if (input.status !== undefined && input.status !== null && !["open", "done", "all"].includes(input.status as string)) {
        return refuse('`status` must be "open", "done" or "all".');
      }
      const filter: Filter = (input.status as Filter | undefined | null) ?? (query === undefined ? "open" : "all");
      const conversation = input.conversation === undefined || input.conversation === null ? undefined : toConversationId(input.conversation);
      if (conversation !== undefined && Number.isNaN(conversation)) return refuse("`conversation` must be a conversation id, a number.");

      const index = await api.snapshot(IndexDoc, context);
      const kept = Object.values(index?.rows ?? {}).filter(
        (row) => (filter === "all" || row.status === filter) && (conversation === undefined || row.involved.includes(conversation)),
      );
      const found: IndexRow[] = query === undefined ? kept.sort((a, b) => b.updatedAt - a.updatedAt) : search(kept, query);
      const what = describeFilter(filter, conversation);

      if (found.length === 0) {
        if (query === undefined) return answer(self, `The blackboard has no ${what}.`);
        return answer(self, `No ${what} match "${query}". The search reads titles, descriptions and closing summaries, not logs; try other words.`);
      }
      const shown = found.slice(0, config.listLimit);
      const head =
        query === undefined
          ? `${found.length} ${what}, most recently updated first.`
          : `${found.length} ${what} match "${query}", best match first.`;
      const tail = found.length > shown.length ? `\n\n${found.length - shown.length} more are not shown. Narrow the list with \`query\`, \`status\` or \`conversation\`.` : "";
      return answer(self, `${head}\n\n${shown.map((row) => rowText(row, self)).join("\n\n")}${tail}`);
    },
  });
}
