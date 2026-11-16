import type { ToolExecutionResult } from "@earendil-works/pi-durable";
/** A normal answer. */
export const answer = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });

/** A refusal. It always says why, so the caller can correct itself. */
export const refuse = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }], isError: true });

/** A JSON Schema object whose properties are required unless listed in `optional`. */
export function parameters(properties: Record<string, object>, optional: readonly string[] = []) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  } as const;
}

export const WORKSTREAM_PARAMETER = { type: ["string", "integer"], description: 'Id of the workstream, as the blackboard shows it: "ws-12", or the number alone.' };

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
