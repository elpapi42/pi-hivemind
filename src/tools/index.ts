import type { HivemindConfig } from "../config.ts";
import { listWorkstreamsTool } from "./list-workstreams.ts";
import { openWorkstreamTool } from "./open-workstream.ts";
import { readLogTool } from "./read-log.ts";
import { readWorkstreamTool } from "./read-workstream.ts";
import { sendMessageTool } from "./send-message.ts";
import { updateWorkstreamTool } from "./update-workstream.ts";
import { whoamiTool } from "./whoami.ts";
import { writeLogTool } from "./write-log.ts";

/** The eight tools. With `codemodeOnly`, none is offered to the model directly: codemode scripts call them. */
export function hivemindTools(config: HivemindConfig) {
  const tools = [
    writeLogTool(config),
    readLogTool(config),
    listWorkstreamsTool(config),
    readWorkstreamTool(config),
    openWorkstreamTool(config),
    updateWorkstreamTool(config),
    sendMessageTool(),
    whoamiTool(),
  ];
  return config.codemodeOnly ? tools.map(scripted) : tools;
}

type AnyTool = ReturnType<typeof readLogTool>;

/**
 * A tool as codemode scripts call it. In a script an error result rejects and ends the script, so a refusal is
 * returned as ordinary text there: the script goes on and the model reads why.
 */
function scripted<T extends { execute: AnyTool["execute"] }>(tool: T): T & { callers: readonly ["tools"] } {
  return {
    ...tool,
    callers: ["tools"] as const,
    execute: async (...args: Parameters<AnyTool["execute"]>) => {
      const { isError: _refused, ...result } = await tool.execute(...args);
      return result;
    },
  };
}
