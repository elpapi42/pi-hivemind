import { logTotal, type DirectoryPiece, type Index, type LogPage, type PageRow, type Workstream } from "./board.ts";
import { matched, termsOf } from "./search.ts";

/** The documents a read of the log needs, however they are reached. */
export type LogSource = {
  index(): Promise<Readonly<Index> | undefined>;
  page(number: number): Promise<Readonly<LogPage> | undefined>;
  piece(number: number): Promise<Readonly<DirectoryPiece> | undefined>;
  workstream(id: number): Promise<Readonly<Workstream> | undefined>;
};

/** An entry with its number. */
export type Found = { n: number; at: number; by: number; text: string; workstream?: number };

export type LogQuery = {
  /** Most entries to return. */
  limit: number;
  /** Return entries with a smaller number than this. */
  before?: number;
  /** Return entries written at or after this time. */
  from?: number;
  /** Return entries written at or before this time. */
  to?: number;
  conversation?: number;
  workstream?: number;
  /** Words the entries must have. */
  query?: string;
};

export type LogResult = {
  /** Oldest first. */
  entries: Found[];
  /** How many entries the log has. */
  total: number;
  /** Present when older entries were not read: reading with this as `before` goes on from there. */
  older?: number;
  /** Present when no entry had every word of the query: how many of its words the entries have. */
  matchedWords?: number;
};

/** For each log page a read opens, it may pass this many by on the word of the directory. */
const SKIPS_PER_PAGE = 100;

/**
 * The newest entries that pass the filters. Pages are read newest first, and only those the filters leave: a
 * workstream names its pages, the directory names the pages of a conversation and of a time. Words have no index, so
 * a search reads pages until it has read `scanPages`, and says where it stopped.
 */
export async function readLog(source: LogSource, scanPages: number, query: LogQuery): Promise<LogResult> {
  const index = await source.index();
  if (index === undefined || index.lastPage < 0) return { entries: [], total: 0 };
  const { pageSize, piecePages } = index;
  const total = logTotal(index, await source.page(index.lastPage));
  /** Entries below this number are wanted. */
  const top = Math.min(total + 1, query.before ?? Number.POSITIVE_INFINITY);
  if (top <= 1) return { entries: [], total };

  const pieces = new Map<number, Readonly<DirectoryPiece> | undefined>();
  const row = async (page: number): Promise<PageRow | undefined> => {
    const number = Math.floor(page / piecePages);
    if (!pieces.has(number)) pieces.set(number, await source.piece(number));
    return pieces.get(number)?.pages[page % piecePages];
  };

  let start = Math.floor((top - 2) / pageSize);
  if (query.to !== undefined) {
    // The last page that starts at or before `to`: pages are in time order.
    let low = 0;
    let high = start;
    let last = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const from = (await row(middle))?.from;
      if (from !== undefined && from <= query.to) {
        last = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (last < 0) return { entries: [], total };
    start = last;
  }

  /** The pages that can hold wanted entries, newest first. */
  const candidates: number[] | undefined =
    query.workstream === undefined ? undefined : [...((await source.workstream(query.workstream))?.pages ?? [])].filter((page) => page <= start).reverse();

  const terms = query.query === undefined ? [] : termsOf(query.query);
  const collected: (Found & { words: number })[] = [];
  let read = 0;
  let skipped = 0;
  /** The page a later read goes on from, when this one stops early. */
  let resume: number | undefined;
  let position = candidates === undefined ? start : 0;
  const next = (): number | undefined => (candidates === undefined ? (position >= 0 ? position : undefined) : candidates[position]);
  const advance = (): void => void (candidates === undefined ? position-- : position++);

  for (let page = next(); page !== undefined; page = next()) {
    if (read >= scanPages || skipped >= scanPages * SKIPS_PER_PAGE) {
      resume = page;
      break;
    }
    if (candidates === undefined && query.conversation !== undefined) {
      const listed = await row(page);
      if (listed !== undefined && !listed.conversations.includes(query.conversation)) {
        skipped++;
        advance();
        continue;
      }
    }
    const entries = (await source.page(page))?.entries ?? [];
    read++;
    let reachedFrom = false;
    for (let i = entries.length - 1; i >= 0; i--) {
      const n = page * pageSize + i + 1;
      const entry = entries[i]!;
      if (n >= top || (query.to !== undefined && entry.at > query.to)) continue;
      if (query.from !== undefined && entry.at < query.from) {
        reachedFrom = true;
        break;
      }
      if (query.conversation !== undefined && entry.by !== query.conversation) continue;
      if (query.workstream !== undefined && entry.workstream !== query.workstream) continue;
      const words = terms.length === 0 ? 0 : matched(entry.text, terms);
      if (terms.length > 0 && words === 0) continue;
      collected.push({ n, at: entry.at, by: entry.by, text: entry.text, ...(entry.workstream === undefined ? {} : { workstream: entry.workstream }), words });
    }
    advance();
    if (reachedFrom) break;
    // Without words the newest entries are the answer, so the read can stop. With words every page in reach is read first.
    if (terms.length === 0 && collected.length >= query.limit) {
      resume = next();
      break;
    }
  }

  // With words: the entries that have all of them, or else those that have the most.
  const best = collected.reduce((most, entry) => Math.max(most, entry.words), 0);
  const kept = terms.length === 0 ? collected : collected.filter((entry) => entry.words === best);
  const shown = kept.slice(0, query.limit);
  let older: number | undefined;
  if (kept.length > shown.length) older = shown[shown.length - 1]!.n;
  else if (resume !== undefined) older = (resume + 1) * pageSize + 1;
  return {
    entries: shown.reverse().map(({ words: _words, ...entry }) => entry),
    total,
    ...(older === undefined || older <= 1 ? {} : { older }),
    ...(terms.length > 1 && shown.length > 0 && best < terms.length ? { matchedWords: best } : {}),
  };
}
