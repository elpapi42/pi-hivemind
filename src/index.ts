import { defineExtension, section } from "@earendil-works/pi-durable";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveConfig, type HivemindConfig } from "./config.ts";
import { PROMPT } from "./prompts.ts";
import { hivemindTools } from "./tools/index.ts";

export { DEFAULT_CONFIG, LIMITS, resolveConfig, type HivemindConfig } from "./config.ts";
export {
  DirectoryDoc,
  IndexDoc,
  LogPageDoc,
  WorkstreamDoc,
  type DirectoryPiece,
  type Entry,
  type Index,
  type Involvement,
  type LogPage,
  type OpenRow,
  type PageRow,
  type Workstream,
} from "./board.ts";

/** The name conversations select the extension by. */
export const EXTENSION_NAME = "pi-hivemind";

/**
 * Hivemind: the conversations of one agent work as a collective and present as one individual. Every conversation
 * writes what it does to one shared log, bigger work gets a workstream, and any conversation can send a message to
 * another.
 *
 * The extension has no hooks and no background work. The prompt section tells the conversations when to use the
 * tools; nothing reminds them.
 */
export function createHivemindExtension(overrides: Partial<HivemindConfig> = {}) {
  const config = resolveConfig(overrides);
  return defineExtension({
    name: EXTENSION_NAME,
    tools: hivemindTools(config),
    // The same text for every conversation, so a fork is sent the system prompt of its parent and reads its provider cache.
    sections: [section("hivemind", () => PROMPT)],
  });
}

/** As Headless Pi loads it: settings come from `<workspace>/.hpi/pi-hivemind.json`, three folders above this one. */
export default createHivemindExtension(loadConfig(fileURLToPath(new URL(`../../../${EXTENSION_NAME}.json`, import.meta.url))));
