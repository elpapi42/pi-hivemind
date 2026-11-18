import { existsSync, readFileSync } from "node:fs";

/** Every setting of Hivemind. */
export type HivemindConfig = {
  /** Offer the tools only to codemode scripts, not to the model directly. For setups where every tool is reached through codemode. */
  codemodeOnly: boolean;
  /** Entries one read of the log returns when the caller names no limit. */
  readLimit: number;
  /** Most log pages one read of the log opens. A search that needs more returns where it stopped. */
  scanPages: number;
  /** Most workstreams one list answer shows. */
  listLimit: number;
  /** Entries one read of a workstream shows. */
  workstreamEntries: number;
  /** Entries one log page holds. Used only when the log is created; after that the index holds the value. */
  pageSize: number;
  /** Log pages one directory piece covers. Used only when the log is created; after that the index holds the value. */
  piecePages: number;
};

export const DEFAULT_CONFIG: HivemindConfig = {
  codemodeOnly: false,
  readLimit: 100,
  scanPages: 50,
  listLimit: 30,
  workstreamEntries: 20,
  pageSize: 200,
  piecePages: 200,
};

/**
 * Ceilings of the texts a conversation writes, in characters. A log entry is short on purpose: it holds one fact, about
 * 50 tokens, so that reading a hundred of them stays cheap. The others are generous: they exist to stop a mistake, such
 * as a whole file pasted into a title, not to make the writer count.
 */
export const LIMITS = {
  entry: 200,
  title: 120,
  description: 4000,
  involvement: 600,
  message: 12_000,
} as const;

/**
 * How far over its ceiling a log entry is still taken. A model cannot count characters exactly: in a trial with real
 * models, one entry in six was 3 to 18 characters over. Such an entry is kept, and its writer is warned. A longer one
 * is refused, and the refusal names both lengths.
 */
export const ENTRY_SLACK = 40;

/** Most entries one read of the log returns, whatever limit the caller names. */
export const MAX_READ = 500;

/** `overrides` over the defaults. A value of the wrong type, or a number that is not a positive integer, is ignored. */
export function resolveConfig(overrides: Partial<Record<keyof HivemindConfig, unknown>> = {}): HivemindConfig {
  const config: HivemindConfig = { ...DEFAULT_CONFIG };
  const values = config as unknown as Record<string, number | boolean>;
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof HivemindConfig)[]) {
    const value = overrides[key];
    if (typeof DEFAULT_CONFIG[key] === "boolean") {
      if (typeof value === "boolean") values[key] = value;
    } else if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      values[key] = value;
    }
  }
  return config;
}

/** Read the optional settings file, `<workspace>/.hpi/pi-hivemind.json`. A missing or unreadable file gives the defaults. */
export function loadConfig(file: string): HivemindConfig {
  if (!existsSync(file)) return resolveConfig();
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return resolveConfig(typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {});
  } catch {
    return resolveConfig();
  }
}
