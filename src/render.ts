import type { OpenRow, Workstream } from "./board.ts";
import type { Found } from "./log.ts";

/** A time as the model reads it: UTC, to the minute. */
export const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** A workstream id as the model reads and writes it. */
export const ref = (id: number): string => `ws-${id}`;

const clip = (text: string, limit: number): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
};

const involvedList = (conversations: readonly number[], self: number): string =>
  conversations.length === 0 ? "nobody" : conversations.map((id) => (id === self ? `${id} (you)` : String(id))).join(", ");

/** One entry of the log, on one line. `named` is false when every entry shown is about the same workstream. */
export function entryText(entry: Found, self: number, named = true): string {
  const who = entry.by === self ? `conversation ${entry.by} (you)` : `conversation ${entry.by}`;
  const about = named && entry.workstream !== undefined ? ` · ${ref(entry.workstream)}` : "";
  return `${entry.n} · ${stamp(entry.at)} · ${who}${about} · ${entry.text}`;
}

/** One open workstream of a list: enough to decide whether to read it. */
export function rowText(row: OpenRow, description: string, self: number): string {
  return [`${ref(row.id)} · ${row.title}`, `  Changed ${stamp(row.updatedAt)} UTC · involved: ${involvedList(row.involved, self)}`, `  ${clip(description, 280)}`].join("\n");
}

/** A whole workstream, with the newest of the log entries that name it. `older` is set when earlier entries exist. */
export function workstreamText(workstream: Workstream, entries: readonly Found[], older: number | undefined, self: number): string {
  const lines = [
    `${ref(workstream.id)} · ${workstream.title} · ${workstream.status}`,
    `Opened ${stamp(workstream.openedAt)} UTC by conversation ${workstream.openedBy} · changed ${stamp(workstream.updatedAt)} UTC` +
      (workstream.closedAt === undefined ? "" : ` · marked done ${stamp(workstream.closedAt)} UTC`),
    "",
    "Description:",
    workstream.description,
  ];
  if (workstream.summary !== undefined) lines.push("", workstream.status === "done" ? "Closing summary:" : "Closing summary from when it was last done:", workstream.summary);

  lines.push("", "Involved:");
  for (const involvement of Object.values(workstream.involved).sort((a, b) => a.since - b.since)) {
    const who = involvement.conversation === self ? `conversation ${involvement.conversation} (you)` : `conversation ${involvement.conversation}`;
    lines.push(`- ${who}, since ${stamp(involvement.since)}: ${involvement.text}`);
  }

  lines.push("", entries.length === 0 ? "Log entries: no earlier entries." : "Log entries, oldest first:");
  for (const entry of entries) lines.push(entryText(entry, self, false));
  if (older !== undefined) lines.push("", `Older entries exist. Call hivemind_read_workstream with before ${older} to see them.`);
  return lines.join("\n");
}

/** A message as the conversation that receives it reads it. */
export function envelope(message: { from: number; workstream?: number; reply: boolean; text: string }): string {
  const about = message.workstream === undefined ? "" : ` workstream="${ref(message.workstream)}"`;
  return `<hivemind-message from="${message.from}"${about} reply="${message.reply ? "expected" : "not expected"}">\n${message.text}\n</hivemind-message>`;
}
