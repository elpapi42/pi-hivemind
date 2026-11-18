import { defineTool } from "@earendil-works/pi-durable";
import { workstreamExists } from "../board.ts";
import { MAX_READ, type HivemindConfig } from "../config.ts";
import { readLog, type Found, type LogQuery } from "../log.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { entryText, ref } from "../render.ts";
import { READ_LOG_OUTPUT } from "./schemas.ts";
import { failure, iso, parameters, result, sourceOf, toConversationId, toText, toTime, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const READ_LOG_TOOL = "hivemind_read_log";

/** One entry as scripts get it. */
export const entryObject = (entry: Found) => ({
  n: entry.n,
  at: iso(entry.at),
  by: entry.by,
  ...(entry.workstream === undefined ? {} : { workstream: ref(entry.workstream) }),
  text: entry.text,
});

const absent = (value: unknown): value is undefined | null => value === undefined || value === null;

export function readLogTool(config: HivemindConfig) {
  return defineTool({
    name: READ_LOG_TOOL,
    description: TOOL_DESCRIPTIONS.readLog,
    parameters: parameters(
      {
        limit: { type: "integer", description: `How many entries to return, at most ${MAX_READ}. Default: ${config.readLimit}.` },
        before: { type: "integer", description: "Return entries before this entry number, for reading further back." },
        from: { type: "string", description: 'Return entries written at or after this time, such as "2026-11-17" or "2026-11-17T14:30:00Z".' },
        to: { type: "string", description: "Return entries written at or before this time." },
        conversation: { type: "integer", description: "Keep only the entries this conversation wrote." },
        workstream: { ...WORKSTREAM_PARAMETER, description: 'Keep only the entries about this workstream, such as "ws-12".' },
        query: { type: "string", description: "Words the entries must have." },
      },
      ["limit", "before", "from", "to", "conversation", "workstream", "query"],
    ),
    structuredOutputSchema: READ_LOG_OUTPUT,
    replay: "safe",
    execute: async (args, api, context) => {
      const input = args as Record<string, unknown>;
      const self = api.conversationId as number;
      const refuse = (error: string) => failure(error, { you: self, total: 0, entries: [] });
      const query: LogQuery = { limit: config.readLimit };
      if (!absent(input.limit)) {
        const limit = Number(input.limit);
        if (!Number.isInteger(limit) || limit < 1) return refuse("`limit` must be a number of entries, 1 or more.");
        query.limit = Math.min(limit, MAX_READ);
      }
      if (!absent(input.before)) {
        const before = Number(input.before);
        if (!Number.isInteger(before) || before < 1) return refuse("`before` must be the number of a log entry.");
        query.before = before;
      }
      for (const name of ["from", "to"] as const) {
        if (absent(input[name])) continue;
        const time = toTime(input[name]);
        if (Number.isNaN(time)) return refuse(`\`${name}\` must be a time such as "2026-11-17" or "2026-11-17T14:30:00Z".`);
        query[name] = time;
      }
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) return refuse("`from` is later than `to`.");
      if (!absent(input.conversation)) {
        const conversation = toConversationId(input.conversation);
        if (Number.isNaN(conversation)) return refuse("`conversation` must be a conversation id, a number.");
        query.conversation = conversation;
      }
      const source = sourceOf(api, context);
      if (!absent(input.workstream)) {
        const workstream = toWorkstreamId(input.workstream);
        if (Number.isNaN(workstream)) return refuse('`workstream` must be a workstream id such as "ws-12".');
        if (!workstreamExists(await source.index(), workstream)) return refuse(`There is no workstream ${ref(workstream)}. Call hivemind_list_workstreams to see the open ones.`);
        query.workstream = workstream;
      }
      const words = toText(input.query);
      if (words !== undefined) query.query = words;

      const found = await readLog(source, config.scanPages, query);
      const structured = {
        you: self,
        total: found.total,
        entries: found.entries.map(entryObject),
        ...(found.older === undefined ? {} : { older: found.older }),
        ...(found.matchedWords === undefined ? {} : { matchedWords: found.matchedWords }),
      };
      const filtered = [query.conversation, query.workstream, query.from, query.to, query.query].some((filter) => filter !== undefined);
      const more = found.older === undefined ? "" : `\n\nOlder entries were not read. Call hivemind_read_log with the same arguments and before ${found.older} to read on.`;
      if (found.entries.length === 0) {
        if (found.total === 0) return result("The log is empty.", structured);
        return result(`No entries${filtered ? " match" : ""} in the part of the log that was read.${more}`, structured);
      }
      const partial = found.matchedWords === undefined ? "" : ` No entry has every word of the query; these have ${found.matchedWords} of them.`;
      const one = found.entries.length === 1;
      const head = `${found.entries.length} ${one ? "entry" : "entries"}${filtered ? (one ? " that matches" : " that match") : ""}, oldest first. The log has ${found.total}.${partial}`;
      return result(`${head}\n\n${found.entries.map((entry) => entryText(entry, self)).join("\n")}${more}`, structured);
    },
  });
}
