import { defineTool } from "@earendil-works/pi-durable";
import type { OpenRow } from "../board.ts";
import type { HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref, rowText } from "../render.ts";
import { searchTitles } from "../search.ts";
import { LIST_WORKSTREAMS_OUTPUT } from "./schemas.ts";
import { failure, iso, parameters, result, sourceOf, toConversationId, toText } from "./shared.ts";

export const LIST_WORKSTREAMS_TOOL = "hivemind_list_workstreams";

export function listWorkstreamsTool(config: HivemindConfig) {
  return defineTool({
    name: LIST_WORKSTREAMS_TOOL,
    description: TOOL_DESCRIPTIONS.listWorkstreams,
    parameters: parameters(
      {
        query: { type: "string", description: "Words to look for in the titles." },
        conversation: { type: "integer", description: "Keep only the workstreams this conversation is involved in." },
      },
      ["query", "conversation"],
    ),
    structuredOutputSchema: LIST_WORKSTREAMS_OUTPUT,
    replay: "safe",
    execute: async (args, api, context) => {
      const input = args as { query?: unknown; conversation?: unknown };
      const self = api.conversationId as number;
      const refuse = (error: string) => failure(error, { you: self, total: 0, workstreams: [] });
      const query = toText(input.query);
      const conversation = input.conversation === undefined || input.conversation === null ? undefined : toConversationId(input.conversation);
      if (conversation !== undefined && Number.isNaN(conversation)) return refuse("`conversation` must be a conversation id, a number.");

      const source = sourceOf(api, context);
      const kept = Object.values((await source.index())?.open ?? {}).filter((row) => conversation === undefined || row.involved.includes(conversation));
      const found: OpenRow[] = query === undefined ? kept.sort((a, b) => b.updatedAt - a.updatedAt) : searchTitles(kept, query);
      // The index holds no descriptions, so the workstreams shown are read for theirs.
      const shown = await Promise.all(found.slice(0, config.listLimit).map(async (row) => ({ row, description: (await source.workstream(row.id))?.description ?? "" })));
      const structured = {
        you: self,
        total: found.length,
        workstreams: shown.map(({ row, description }) => ({ id: ref(row.id), title: row.title, updatedAt: iso(row.updatedAt), involved: [...row.involved], description })),
      };
      const what = `open workstreams${conversation === undefined ? "" : ` that involve conversation ${conversation}`}`;
      const done = "A workstream that was marked done is not listed: find it in the log with hivemind_read_log.";

      if (found.length === 0) {
        if (query === undefined) return result(`There are no ${what}. ${done}`, structured);
        return result(`No ${what} have "${query}" in the title. The search reads titles only; the log holds the rest. ${done}`, structured);
      }
      const head = query === undefined ? `${found.length} ${what}, most recently changed first.` : `${found.length} ${what} match "${query}", best match first.`;
      const tail = found.length > shown.length ? `\n\n${found.length - shown.length} more are not shown. Narrow the list with \`query\` or \`conversation\`.` : "";
      return result(`${head}\n\n${shown.map(({ row, description }) => rowText(row, description, self)).join("\n\n")}${tail}`, structured);
    },
  });
}
