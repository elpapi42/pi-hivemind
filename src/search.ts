/** Lowercase words and numbers of a text. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The different words of a query. */
export const termsOf = (query: string): string[] => [...new Set(tokenize(query))];

/** Whether a word of a text answers a word of the query: the same word, or one that begins with the other ("invoice", "invoices"). */
function answers(word: string, term: string): boolean {
  if (word === term) return true;
  return Math.min(word.length, term.length) >= 4 && (word.startsWith(term) || term.startsWith(word));
}

/** How often the words answer the term. */
const hits = (words: readonly string[], term: string): number => words.reduce((count, word) => count + (answers(word, term) ? 1 : 0), 0);

/** How many of the terms a text has. */
export function matched(text: string, terms: readonly string[]): number {
  const words = tokenize(text);
  return terms.reduce((count, term) => count + (words.some((word) => answers(word, term)) ? 1 : 0), 0);
}

/**
 * The rows whose title matches the query, best first. A row that matches more of the query's words ranks above one
 * that matches fewer; then the one that matches them more often; then the one updated last.
 */
export function searchTitles<Row extends { title: string; updatedAt: number }>(rows: readonly Row[], query: string): Row[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const scored = rows.map((row) => {
    const title = tokenize(row.title);
    let found = 0;
    let score = 0;
    for (const term of terms) {
      const count = hits(title, term);
      if (count > 0) found++;
      score += count;
    }
    return { row, found, score };
  });
  return scored
    .filter((item) => item.found > 0)
    .sort((a, b) => b.found - a.found || b.score - a.score || b.row.updatedAt - a.row.updatedAt)
    .map((item) => item.row);
}
