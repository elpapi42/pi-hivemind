import { defineDoc, defineDocFamily, type ConversationId, type JsonObject, type Tx } from "@earendil-works/pi-durable";
import type { HivemindConfig } from "./config.ts";

/*
 * What Hivemind stores, as documents of the whole harness. Pi Durable reads a document only by its exact address and
 * always whole, so no document here grows with history:
 *
 *   hivemind.index       one document: where the log ends, the next workstream id, and the open workstreams
 *   hivemind.log         one document per page of the log, keyed by page number
 *   hivemind.directory   one document per run of pages, keyed by piece number: what each page holds
 *   hivemind.workstream  one document per workstream, keyed by its id
 */

/** One thing a conversation did, found out, decided or was told. */
export type Entry = {
  at: number;
  /** The conversation that wrote it. */
  by: number;
  text: string;
  /** The workstream it is about, when there is one. */
  workstream?: number;
};

/**
 * One page of the log, oldest entry first. An entry's number is not stored: it is its place in the log, so entry `n`
 * is on page `floor((n - 1) / pageSize)`. A full page never changes again.
 */
export type LogPage = { entries: Entry[] };

/** What the directory knows about one log page: enough to pass it by without reading it. */
export type PageRow = {
  /** Time of the page's first entry. Pages are in time order, so this finds the page of a moment. */
  from: number;
  /** Every conversation that wrote on the page. */
  conversations: number[];
};

/** The directory rows of one run of pages; page `p` is at position `p % piecePages` of piece `floor(p / piecePages)`. */
export type DirectoryPiece = { pages: PageRow[] };

/** The part one conversation has in a workstream, in its own words. */
export type Involvement = {
  conversation: number;
  /** Why it is involved and what it is responsible for. */
  text: string;
  since: number;
  updatedAt: number;
};

export type Status = "open" | "done";

/** A piece of work with an outcome, and the conversations that have a part in it. Its history is the log entries that name it. */
export type Workstream = {
  id: number;
  title: string;
  /** The current state. Rewritten as the state changes; the log keeps what happened on the way. */
  description: string;
  status: Status;
  /** Written when it is marked done: what happened and how it ended. Kept when it is reopened, until it is done again. */
  summary?: string;
  openedAt: number;
  openedBy: number;
  /** When the description, an involvement or the status last changed. A log entry does not move it. */
  updatedAt: number;
  closedAt?: number;
  /** By conversation id. */
  involved: Record<string, Involvement>;
  /** The log pages that hold its entries, oldest first. */
  pages: number[];
};

/** What the index knows about one open workstream: enough to list it and to find it by its title or its conversations. */
export type OpenRow = {
  id: number;
  title: string;
  updatedAt: number;
  involved: number[];
};

/**
 * The index holds only what is live, so its size follows the open work, not the history. A workstream that is marked
 * done leaves it: it is read by its id, and found through the log.
 */
export type Index = {
  /** Entries per log page, fixed when the log is created; 0 until then. Entry numbers depend on it. */
  pageSize: number;
  /** Log pages per directory piece, fixed when the log is created; 0 until then. */
  piecePages: number;
  /** Number of the newest log page; -1 while the log is empty. */
  lastPage: number;
  /** The id the next workstream gets. Every smaller id is a workstream that exists. */
  nextWorkstream: number;
  /** The open workstreams, by id. */
  open: Record<string, OpenRow>;
};

/** A base after this many deltas. Every document here is small, so a base is cheap. */
const checkpointWhen = (_value: unknown, _ops: unknown, info: { deltasSinceBase: number }): boolean => info.deltasSinceBase >= 64;

export const IndexDoc = defineDoc<Index>({
  kind: "hivemind.index",
  version: 2,
  scope: "session",
  initial: () => ({ pageSize: 0, piecePages: 0, lastPage: -1, nextWorkstream: 1, open: {} }),
  // Version 1 held a row for every workstream, open and done, with a copy of its description, and no log.
  migrate: (value) => {
    const old = value as { next?: number; rows?: Record<string, { id: number; title: string; status: string; updatedAt: number; involved: number[] }> };
    const open: Record<string, OpenRow> = {};
    for (const row of Object.values(old.rows ?? {})) {
      if (row.status === "open") open[String(row.id)] = { id: row.id, title: row.title, updatedAt: row.updatedAt, involved: [...row.involved] };
    }
    return { pageSize: 0, piecePages: 0, lastPage: -1, nextWorkstream: old.next ?? 1, open };
  },
  checkpointWhen,
});

export const LogPageDoc = defineDocFamily<LogPage, null>({
  kind: "hivemind.log",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ entries: [] }),
  checkpointWhen,
});

export const DirectoryDoc = defineDocFamily<DirectoryPiece, null>({
  kind: "hivemind.directory",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ pages: [] }),
  checkpointWhen,
});

type Seed = { id: number; title: string; description: string; at: number; by: number };

export const WorkstreamDoc = defineDocFamily<Workstream, Seed>({
  kind: "hivemind.workstream",
  version: 2,
  scope: "session",
  family: true,
  initial: (seed) => ({
    id: seed.id,
    title: seed.title,
    description: seed.description,
    status: "open",
    openedAt: seed.at,
    openedBy: seed.by,
    updatedAt: seed.at,
    involved: {},
    pages: [],
  }),
  // Version 1 kept its own log. Those entries are not carried over.
  migrate: (value) => {
    const { log: _log, ...rest } = value as JsonObject;
    return { ...rest, pages: [] } as unknown as Workstream;
  },
  checkpointWhen,
});

export const asConversationId = (id: number): ConversationId => id as ConversationId;

/** Whether the conversation has a part in the workstream. */
export const isInvolved = (workstream: Pick<Workstream, "involved">, conversation: number): boolean => workstream.involved[String(conversation)] !== undefined;

/** Whether a workstream has this id. Ids are given out in order and never taken back, so no document is read. */
export const workstreamExists = (index: Pick<Index, "nextWorkstream"> | undefined, id: number): boolean =>
  index !== undefined && Number.isInteger(id) && id >= 1 && id < index.nextWorkstream;

/** How many entries the log has, given its newest page. */
export const logTotal = (index: Index, newest: LogPage | undefined): number => (index.lastPage < 0 ? 0 : index.lastPage * index.pageSize + (newest?.entries.length ?? 0));

/**
 * Add one entry to the log, and return its number. `workstream` is the workstream the entry is about, as the commit
 * holds it. Most calls write one document, the newest page; the directory is written when a conversation first
 * appears on a page, the index when a page starts, and the workstream when it first appears on a page.
 */
export async function appendEntry(
  tx: Tx,
  config: Pick<HivemindConfig, "pageSize" | "piecePages">,
  input: { by: number; at: number; text: string; workstream?: Workstream },
): Promise<number> {
  const index = await tx.doc(IndexDoc);
  if (index.pageSize === 0) {
    index.pageSize = config.pageSize;
    index.piecePages = config.piecePages;
  }
  let page = index.lastPage < 0 ? undefined : await tx.doc(LogPageDoc, String(index.lastPage), null);
  // Entries stay in time order, also when two clocks disagree by a moment: the directory finds pages by time.
  const previous = page?.entries[page.entries.length - 1];
  const at = previous !== undefined && previous.at > input.at ? previous.at : input.at;
  if (page === undefined || page.entries.length >= index.pageSize) {
    index.lastPage++;
    page = await tx.doc(LogPageDoc, String(index.lastPage), null);
  }
  page.entries.push({ at, by: input.by, text: input.text, ...(input.workstream === undefined ? {} : { workstream: input.workstream.id }) });

  const piece = await tx.doc(DirectoryDoc, String(Math.floor(index.lastPage / index.piecePages)), null);
  const row = piece.pages[index.lastPage % index.piecePages];
  if (row === undefined) piece.pages.push({ from: at, conversations: [input.by] });
  else if (!row.conversations.includes(input.by)) row.conversations.push(input.by);

  const pages = input.workstream?.pages;
  if (pages !== undefined && pages[pages.length - 1] !== index.lastPage) pages.push(index.lastPage);
  return index.lastPage * index.pageSize + page.entries.length;
}

/** Create a workstream with `by` as its first involved conversation, its index row, and the log entry that says so. */
export async function openWorkstream(
  tx: Tx,
  config: Pick<HivemindConfig, "pageSize" | "piecePages">,
  input: { title: string; description: string; involvement: string; by: number; at: number },
): Promise<Workstream> {
  const index = await tx.doc(IndexDoc);
  const id = index.nextWorkstream++;
  const workstream = await tx.doc(WorkstreamDoc, String(id), { id, title: input.title, description: input.description, at: input.at, by: input.by });
  workstream.involved[String(input.by)] = { conversation: input.by, text: input.involvement, since: input.at, updatedAt: input.at };
  index.open[String(id)] = rowOf(workstream);
  await appendEntry(tx, config, { by: input.by, at: input.at, text: `Opened ws-${id}: ${input.title}`, workstream });
  return workstream;
}

/** The workstream to change, or `undefined` when no workstream has this id. Asking never creates one. */
export async function workstreamForUpdate(tx: Tx, id: number): Promise<Workstream | undefined> {
  if (!workstreamExists(await tx.doc(IndexDoc), id)) return undefined;
  // The seed is only used for an absent document, which the id rules out.
  return tx.doc(WorkstreamDoc, String(id), { id, title: "", description: "", at: 0, by: 0 });
}

/** Make the index follow the workstream: its row while it is open, no row once it is done. Call it in the commit that changed the workstream. */
export async function reindex(tx: Tx, workstream: Workstream): Promise<void> {
  const index = await tx.doc(IndexDoc);
  if (workstream.status === "open") index.open[String(workstream.id)] = rowOf(workstream);
  else delete index.open[String(workstream.id)];
}

function rowOf(workstream: Workstream): OpenRow {
  return {
    id: workstream.id,
    title: workstream.title,
    updatedAt: workstream.updatedAt,
    involved: Object.values(workstream.involved).map((involvement) => involvement.conversation),
  };
}
