import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { DirectoryDoc, IndexDoc, LogPageDoc, WorkstreamDoc } from "../board.ts";
import type { LogSource } from "../log.ts";

type Structured = NonNullable<ToolExecutionResult["structuredOutput"]>;

/** An answer: the text for a model that calls the tool directly, the object for scripts. */
export const result = (text: string, structuredOutput: Structured): ToolExecutionResult => ({ output: [{ type: "text", text }], structuredOutput });

/**
 * A refusal that keeps the tool's object, with `error` saying why, so a script receives the object and reads `error`
 * instead of ending.
 */
export const failure = (error: string, empty: { readonly [key: string]: Structured }): ToolExecutionResult => ({
  output: [{ type: "text", text: error }],
  structuredOutput: { ...empty, error },
  isError: true,
});

/**
 * A refusal with no object. A script that makes such a call stops with this text as its error, so the conversation
 * always reads it. For a call whose refusal must not pass unnoticed, such as a log entry that was not written.
 */
export const rejection = (error: string): ToolExecutionResult => ({ output: [{ type: "text", text: error }], isError: true });

/** A time as scripts get it. */
export const iso = (ms: number): string => new Date(ms).toISOString();

/** A JSON Schema object whose properties are required unless listed in `optional`. */
export function parameters(properties: Record<string, object>, optional: readonly string[] = []) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  } as const;
}

export const WORKSTREAM_PARAMETER = { type: ["string", "integer"], description: 'Id of the workstream: "ws-12", or the number alone.' };

/** A workstream id from "ws-12", "12" or 12; `NaN` for anything else. */
export function toWorkstreamId(value: unknown): number {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : Number.NaN;
  if (typeof value !== "string") return Number.NaN;
  const digits = /^\s*(?:ws[-_ ]?|#)?(\d+)\s*$/i.exec(value)?.[1];
  return digits === undefined ? Number.NaN : Number(digits);
}

/** A conversation id as a number; models sometimes send it as a string. */
export function toConversationId(value: unknown): number {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(id) && id > 0 ? id : Number.NaN;
}

/** A text argument without surrounding space; `undefined` when it is absent or empty. */
export function toText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

/** Why a text is refused for its length, or `undefined` when it fits. */
export function tooLong(name: string, text: string | undefined, limit: number): string | undefined {
  if (text === undefined || text.length <= limit) return undefined;
  return `\`${name}\` has ${text.length} characters; the most is ${limit}. Shorten it and call again.`;
}

/** The first reason that is not `undefined`. */
export const firstReason = (...reasons: (string | undefined)[]): string | undefined => reasons.find((reason) => reason !== undefined);

/** A moment from "2026-11-17", "2026-11-17T14:30:00Z" or a number of milliseconds; `NaN` for anything else. */
export function toTime(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  return typeof value === "string" && value.trim() !== "" ? Date.parse(value.trim()) : Number.NaN;
}

/** The committed documents of the log, as a tool reads them. */
export function sourceOf(api: { snapshot: (...args: never[]) => Promise<unknown> }, context: unknown): LogSource {
  const snapshot = api.snapshot as unknown as (...args: unknown[]) => Promise<never>;
  return {
    index: () => snapshot(IndexDoc, context),
    page: (number) => snapshot(LogPageDoc, String(number), context),
    piece: (number) => snapshot(DirectoryDoc, String(number), context),
    workstream: (id) => snapshot(WorkstreamDoc, String(id), context),
  };
}
