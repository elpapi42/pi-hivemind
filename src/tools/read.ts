import { defineTool } from "@earendil-works/pi-durable";
import { isInvolved, WorkstreamDoc, type Workstream } from "../board.ts";
import type { HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { logPage, ref, workstreamText } from "../render.ts";
import { READ_OUTPUT } from "./schemas.ts";
import { failure, iso, parameters, result, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const READ_TOOL = "hivemind_read";

/** A workstream as scripts get it, with the same page of its log as the text shows. */
function workstreamObject(workstream: Workstream, pageSize: number, before: number | undefined) {
  const { start, end } = logPage(workstream.log.length, pageSize, before);
  return {
    id: ref(workstream.id),
    title: workstream.title,
    status: workstream.status,
    updatedAt: iso(workstream.updatedAt),
    description: workstream.description,
    ...(workstream.summary === undefined ? {} : { summary: workstream.summary }),
    involved: Object.values(workstream.involved)
      .sort((a, b) => a.since - b.since)
      .map((involvement) => ({ conversation: involvement.conversation, part: involvement.text, since: iso(involvement.since) })),
    log: workstream.log.slice(start, end).map((entry, i) => ({ n: start + i + 1, at: iso(entry.at), by: entry.by, text: entry.text })),
    logTotal: workstream.log.length,
  };
}

export function readTool(config: HivemindConfig) {
  return defineTool({
    name: READ_TOOL,
    description: TOOL_DESCRIPTIONS.read,
    parameters: parameters(
      {
        workstream: WORKSTREAM_PARAMETER,
        before: { type: "integer", description: "Show the log entries before this entry number, for reading further back." },
      },
      ["before"],
    ),
    structuredOutputSchema: READ_OUTPUT,
    replay: "safe",
    execute: async (args, api, context) => {
      const input = args as { workstream: unknown; before?: unknown };
      const self = api.conversationId as number;
      const refuse = (error: string) => failure(error, { you: self });
      const id = toWorkstreamId(input.workstream);
      if (Number.isNaN(id)) return refuse('`workstream` must be a workstream id such as "ws-12".');
      const before = input.before === undefined || input.before === null ? undefined : Number(input.before);
      if (before !== undefined && (!Number.isInteger(before) || before < 1)) return refuse("`before` must be the number of a log entry.");

      const workstream = await api.snapshot(WorkstreamDoc, String(id), context);
      if (workstream === undefined) return refuse(`There is no workstream ${ref(id)}. Call hivemind_list to see the ones that exist.`);
      const part = isInvolved(workstream, self) ? "" : "You are not involved in this workstream.\n\n";
      return result(part + workstreamText(workstream, self, config.logPage, before), {
        you: self,
        workstream: workstreamObject(workstream, config.logPage, before),
      });
    },
  });
}
