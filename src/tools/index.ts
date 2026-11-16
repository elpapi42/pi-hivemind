import type { HivemindConfig } from "../config.ts";
import { listTool } from "./list.ts";
import { messageTool } from "./message.ts";
import { openTool } from "./open.ts";
import { readTool } from "./read.ts";
import { updateTool } from "./update.ts";
import { whoamiTool } from "./whoami.ts";

/** The six tools. With `codemodeOnly`, none is offered to the model directly: codemode scripts call them. */
export function hivemindTools(config: HivemindConfig) {
  const tools = [listTool(config), readTool(config), openTool(), updateTool(), messageTool(), whoamiTool()];
  return config.codemodeOnly ? tools.map(scripted) : tools;
}

type AnyTool = ReturnType<typeof listTool>;

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
