import { defineTool } from "@earendil-works/pi-durable";
import { isInvolved, WorkstreamDoc } from "../board.ts";
import type { HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref, workstreamText } from "../render.ts";
import { answer, parameters, refuse, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const READ_TOOL = "hivemind_read";

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
    replay: "safe",
    execute: async (args, api, context) => {
      const input = args as { workstream: unknown; before?: unknown };
      const self = api.conversationId as number;
      const id = toWorkstreamId(input.workstream);
      if (Number.isNaN(id)) return refuse('`workstream` must be a workstream id such as "ws-12".');
      const before = input.before === undefined || input.before === null ? undefined : Number(input.before);
      if (before !== undefined && (!Number.isInteger(before) || before < 1)) return refuse("`before` must be the number of a log entry.");

      const workstream = await api.snapshot(WorkstreamDoc, String(id), context);
      if (workstream === undefined) return refuse(`There is no workstream ${ref(id)}. Call hivemind_list to see the ones that exist.`);
      const part = isInvolved(workstream, self) ? "" : "You are not involved in this workstream.\n\n";
      return answer(part + workstreamText(workstream, self, config.logPage, before));
    },
  });
}
