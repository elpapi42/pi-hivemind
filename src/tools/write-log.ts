import { defineTool } from "@earendil-works/pi-durable";
import { appendEntry, workstreamForUpdate } from "../board.ts";
import { ENTRY_SLACK, LIMITS, type HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { WRITE_LOG_OUTPUT } from "./schemas.ts";
import { failure, parameters, result, toText, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const WRITE_LOG_TOOL = "hivemind_write_log";

export function writeLogTool(config: HivemindConfig) {
  return defineTool({
    name: WRITE_LOG_TOOL,
    description: TOOL_DESCRIPTIONS.writeLog,
    parameters: parameters(
      {
        text: { type: "string", description: "One fact, in at most 200 characters, that stands alone." },
        workstream: { ...WORKSTREAM_PARAMETER, description: 'Id of the workstream the entry is about, such as "ws-12", when there is one.' },
      },
      ["workstream"],
    ),
    structuredOutputSchema: WRITE_LOG_OUTPUT,
    executionMode: "sequential",
    execute: async (args, api, context) => {
      // A refused entry is an entry the log never gets, so the refusal says plainly that nothing was written.
      const refuse = (error: string) => failure(`${error} Nothing was written to the log.`, {});
      const input = args as { text?: unknown; workstream?: unknown };
      const text = toText(input.text)?.replace(/\s+/g, " ");
      if (text === undefined) return refuse("`text` is empty. Write the entry.");
      if (text.length > LIMITS.entry + ENTRY_SLACK) {
        return refuse(`The entry is too long: \`text\` has ${text.length} characters, and the most is ${LIMITS.entry}. An entry holds one fact: shorten it, or split it into two entries, and write it again.`);
      }
      const id = input.workstream === undefined || input.workstream === null ? undefined : toWorkstreamId(input.workstream);
      if (id !== undefined && Number.isNaN(id)) return refuse('`workstream` must be a workstream id such as "ws-12".');

      return api.commit(async (tx) => {
        const workstream = id === undefined ? undefined : await workstreamForUpdate(tx, id);
        if (id !== undefined && workstream === undefined) {
          return refuse(`There is no workstream ${ref(id)}. Leave \`workstream\` out, or call hivemind_list_workstreams to find the right one.`);
        }
        const n = await appendEntry(tx, config, { by: api.conversationId as number, at: api.now(), text, ...(workstream === undefined ? {} : { workstream }) });
        // An entry a little over the ceiling is kept, and its writer is told.
        const warning = text.length > LIMITS.entry ? `The entry has ${text.length} characters. The most is ${LIMITS.entry}: write shorter entries.` : undefined;
        return result(`Wrote entry ${n}${id === undefined ? "" : ` about ${ref(id)}`}.${warning === undefined ? "" : ` ${warning}`}`, { n, ...(warning === undefined ? {} : { warning }) });
      }, context);
    },
  });
}
