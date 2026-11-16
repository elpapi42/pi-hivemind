import { defineDoc, defineDocFamily, type ConversationId, type Tx } from "@earendil-works/pi-durable";

/** The part one conversation has in a workstream, in its own words. */
export type Involvement = {
  conversation: number;
  /** Why it is involved and what it is responsible for. */
  text: string;
  since: number;
  updatedAt: number;
};

/** One thing that happened to the work. */
export type LogEntry = {
  at: number;
  /** The conversation that wrote it. */
  by: number;
  text: string;
};

export type Status = "open" | "done";

/** A piece of work with an outcome, and the conversations that have a part in it. */
export type Workstream = {
  id: number;
  title: string;
  /** The current state. Rewritten as the state changes; the log keeps what happened on the way. */
  description: string;
  status: Status;
  /** Written when it is marked done: what happened and how it ended. */
  summary?: string;
  openedAt: number;
  openedBy: number;
  updatedAt: number;
  closedAt?: number;
  /** By conversation id. */
  involved: Record<string, Involvement>;
  /** Oldest first. Entries are only ever added. */
  log: LogEntry[];
};

/** What the index knows about one workstream: enough to list it, filter it and find it by its words. */
export type IndexRow = {
  id: number;
  title: string;
  status: Status;
  description: string;
  summary?: string;
  updatedAt: number;
  involved: number[];
};

/** Every workstream of the harness, by id. Pi Durable cannot list or search documents, so the blackboard keeps its own index. */
export type Index = {
  /** The id the next workstream gets. */
  next: number;
  rows: Record<string, IndexRow>;
};

export const IndexDoc = defineDoc<Index>({
  kind: "hivemind.index",
  version: 1,
  scope: "session",
  initial: () => ({ next: 1, rows: {} }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 64,
});

type Seed = { id: number; title: string; description: string; at: number; by: number };

export const WorkstreamDoc = defineDocFamily<Workstream, Seed>({
  kind: "hivemind.workstream",
  version: 1,
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
    log: [],
  }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 64,
});

export const asConversationId = (id: number): ConversationId => id as ConversationId;

/** Whether the conversation has a part in the workstream. */
export const isInvolved = (workstream: Pick<Workstream, "involved">, conversation: number): boolean => workstream.involved[String(conversation)] !== undefined;

/** Create a workstream with `by` as its first involved conversation, and its index row. */
export async function openWorkstream(tx: Tx, input: { title: string; description: string; involvement: string; by: number; at: number }): Promise<Workstream> {
  const index = await tx.doc(IndexDoc);
  const id = index.next++;
  const workstream = await tx.doc(WorkstreamDoc, String(id), { id, title: input.title, description: input.description, at: input.at, by: input.by });
  workstream.involved[String(input.by)] = { conversation: input.by, text: input.involvement, since: input.at, updatedAt: input.at };
  workstream.log.push({ at: input.at, by: input.by, text: "Opened." });
  index.rows[String(id)] = rowOf(workstream);
  return workstream;
}

/** The workstream to change, or `undefined` when no workstream has this id. Asking never creates one. */
export async function workstreamForUpdate(tx: Tx, id: number): Promise<Workstream | undefined> {
  const index = await tx.doc(IndexDoc);
  const row = index.rows[String(id)];
  if (row === undefined) return undefined;
  // The seed is only used for an absent document, which the index row rules out.
  return tx.doc(WorkstreamDoc, String(id), { id, title: row.title, description: row.description, at: row.updatedAt, by: 0 });
}

/** Store what changed in the workstream's index row. Call it in the commit that changed the workstream. */
export async function reindex(tx: Tx, workstream: Workstream): Promise<void> {
  (await tx.doc(IndexDoc)).rows[String(workstream.id)] = rowOf(workstream);
}

function rowOf(workstream: Workstream): IndexRow {
  return {
    id: workstream.id,
    title: workstream.title,
    status: workstream.status,
    description: workstream.description,
    ...(workstream.summary === undefined ? {} : { summary: workstream.summary }),
    updatedAt: workstream.updatedAt,
    involved: Object.values(workstream.involved).map((involvement) => involvement.conversation),
  };
}
