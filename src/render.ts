import type { IndexRow, Workstream } from "./board.ts";

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

/** One workstream of a list: enough to decide whether to read it. */
export function rowText(row: IndexRow, self: number): string {
  const state = row.status === "done" ? "done" : "open";
  const text = row.status === "done" && row.summary !== undefined ? `Closing summary: ${clip(row.summary, 280)}` : clip(row.description, 280);
  return [`${ref(row.id)} · ${row.title} · ${state}`, `  Updated ${stamp(row.updatedAt)} UTC · involved: ${involvedList(row.involved, self)}`, `  ${text}`].join("\n");
}

/**
 * A whole workstream. The log is shown a page at a time, newest page first: `before` is the number of the entry the
 * page ends before, and absent for the newest page.
 */
export function workstreamText(workstream: Workstream, self: number, pageSize: number, before?: number): string {
  const lines = [
    `${ref(workstream.id)} · ${workstream.title} · ${workstream.status}`,
    `Opened ${stamp(workstream.openedAt)} UTC by conversation ${workstream.openedBy} · updated ${stamp(workstream.updatedAt)} UTC` +
      (workstream.closedAt === undefined ? "" : ` · marked done ${stamp(workstream.closedAt)} UTC`),
    "",
    "Description:",
    workstream.description,
  ];
  if (workstream.summary !== undefined) lines.push("", "Closing summary:", workstream.summary);

  lines.push("", "Involved:");
  for (const involvement of Object.values(workstream.involved).sort((a, b) => a.since - b.since)) {
    const who = involvement.conversation === self ? `conversation ${involvement.conversation} (you)` : `conversation ${involvement.conversation}`;
    lines.push(`- ${who}, since ${stamp(involvement.since)}: ${involvement.text}`);
  }

  const total = workstream.log.length;
  const end = before === undefined ? total : Math.max(0, Math.min(total, before - 1));
  const start = Math.max(0, end - pageSize);
  lines.push("", end === 0 ? "Log: no earlier entries." : `Log (entries ${start + 1} to ${end} of ${total}):`);
  for (let i = start; i < end; i++) {
    const entry = workstream.log[i]!;
    lines.push(`${i + 1}. ${stamp(entry.at)} · conversation ${entry.by} · ${entry.text}`);
  }
  if (start > 0) lines.push("", `Older entries exist. Call hivemind_read with before ${start + 1} to see them.`);
  return lines.join("\n");
}

/** A message as the conversation that receives it reads it. */
export function envelope(message: { from: number; workstream?: number; reply: boolean; text: string }): string {
  const about = message.workstream === undefined ? "" : ` workstream="${ref(message.workstream)}"`;
  return `<hivemind-message from="${message.from}"${about} reply="${message.reply ? "expected" : "not expected"}">\n${message.text}\n</hivemind-message>`;
}
