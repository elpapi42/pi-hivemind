import { defineTool } from "@earendil-works/pi-durable";
import { isInvolved } from "../board.ts";
import type { HivemindConfig } from "../config.ts";
import { readLog } from "../log.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref, workstreamText } from "../render.ts";
import { READ_WORKSTREAM_OUTPUT } from "./schemas.ts";
import { failure, iso, parameters, result, sourceOf, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const READ_WORKSTREAM_TOOL = "hivemind_read_workstream";

export function readWorkstreamTool(config: HivemindConfig) {
  return defineTool({
    name: READ_WORKSTREAM_TOOL,
    description: TOOL_DESCRIPTIONS.readWorkstream,
    parameters: parameters(
      {
        workstream: WORKSTREAM_PARAMETER,
        before: { type: "integer", description: "Show the entries before this entry number, for reading further back." },
      },
      ["before"],
    ),
    structuredOutputSchema: READ_WORKSTREAM_OUTPUT,
    replay: "safe",
    execute: async (args, api, context) => {
      const input = args as { workstream: unknown; before?: unknown };
      const self = api.conversationId as number;
      const refuse = (error: string) => failure(error, { you: self });
      const id = toWorkstreamId(input.workstream);
      if (Number.isNaN(id)) return refuse('`workstream` must be a workstream id such as "ws-12".');
      const before = input.before === undefined || input.before === null ? undefined : Number(input.before);
      if (before !== undefined && (!Number.isInteger(before) || before < 1)) return refuse("`before` must be the number of a log entry.");

      const source = sourceOf(api, context);
      const workstream = await source.workstream(id);
      if (workstream === undefined) return refuse(`There is no workstream ${ref(id)}. Call hivemind_list_workstreams to see the open ones.`);
      // The workstream names the pages of its entries, so only those are read: one page for each entry at most.
      const log = await readLog(source, Math.max(config.scanPages, config.workstreamEntries), {
        workstream: id,
        limit: config.workstreamEntries,
        ...(before === undefined ? {} : { before }),
      });
      const part = isInvolved(workstream, self) ? "" : "You are not involved in this workstream.\n\n";
      return result(part + workstreamText(workstream, log.entries, log.older, self), {
        you: self,
        workstream: {
          id: ref(workstream.id),
          title: workstream.title,
          status: workstream.status,
          updatedAt: iso(workstream.updatedAt),
          description: workstream.description,
          ...(workstream.summary === undefined ? {} : { summary: workstream.summary }),
          involved: Object.values(workstream.involved)
            .sort((a, b) => a.since - b.since)
            .map((involvement) => ({ conversation: involvement.conversation, part: involvement.text, since: iso(involvement.since) })),
          entries: log.entries.map((entry) => ({ n: entry.n, at: iso(entry.at), by: entry.by, text: entry.text })),
          ...(log.older === undefined ? {} : { older: log.older }),
        },
      });
    },
  });
}
