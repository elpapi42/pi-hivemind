import type { IndexRow } from "./board.ts";

/** Lowercase words and numbers of a text. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Whether a word of a text answers a word of the query: the same word, or one that begins with the other ("invoice", "invoices"). */
function answers(word: string, term: string): boolean {
  if (word === term) return true;
  return Math.min(word.length, term.length) >= 4 && (word.startsWith(term) || term.startsWith(word));
}

/** How often the words answer the term. */
const hits = (words: readonly string[], term: string): number => words.reduce((count, word) => count + (answers(word, term) ? 1 : 0), 0);

/** A word of the query found in the title counts as much as this many mentions in the text. */
const TITLE_WEIGHT = 5;

/**
 * The rows that match the query, best first. A row that matches more of the query's words ranks above one that
 * matches fewer; then the one that matches them more often, the title counting most; then the one updated last.
 * The log of a workstream is not in the index, so it is not searched.
 */
export function search(rows: readonly IndexRow[], query: string): IndexRow[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const scored = rows.map((row) => {
    const title = tokenize(row.title);
    const text = tokenize(`${row.description} ${row.summary ?? ""}`);
    let matched = 0;
    let score = 0;
    for (const term of terms) {
      const found = hits(title, term) * TITLE_WEIGHT + hits(text, term);
      if (found > 0) matched++;
      // The logarithm keeps a word repeated many times from outweighing a second word of the query.
      score += Math.log1p(found);
    }
    return { row, matched, score };
  });
  return scored
    .filter((item) => item.matched > 0)
    .sort((a, b) => b.matched - a.matched || b.score - a.score || b.row.updatedAt - a.row.updatedAt)
    .map((item) => item.row);
}
