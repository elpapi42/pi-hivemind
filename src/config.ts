import { existsSync, readFileSync } from "node:fs";

/** Every setting of Hivemind. */
export type HivemindConfig = {
  /** Offer the tools only to codemode scripts, not to the model directly. For setups where every tool is reached through codemode. */
  codemodeOnly: boolean;
  /** Most workstreams one list answer shows. */
  listLimit: number;
  /** Most log entries one read answer shows. */
  logPage: number;
};

export const DEFAULT_CONFIG: HivemindConfig = {
  codemodeOnly: false,
  listLimit: 30,
  logPage: 20,
};

/**
 * Ceilings of the texts a conversation writes, in characters. They are generous on purpose: they exist to stop a
 * mistake, such as a whole file pasted into a title, not to make the writer count.
 */
export const LIMITS = {
  title: 120,
  description: 4000,
  involvement: 600,
  log: 1500,
  summary: 3000,
  message: 12_000,
} as const;

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
