import assert from "node:assert/strict";
import { test } from "node:test";
import { matched, searchTitles, termsOf, tokenize } from "../src/search.ts";

const row = (id: number, title: string) => ({ id, title, updatedAt: id });

test("titles are ranked by how many words of the query they have, then by how often, then by the newest", () => {
  const rows = [row(1, "Login page redesign"), row(2, "Bulk invoice export"), row(3, "Finance dashboard"), row(4, "Invoice numbering bug"), row(5, "Invoice export of invoices")];
  assert.deepEqual(searchTitles(rows, "invoice export").map((found) => found.id), [5, 2, 4], "both words and more often first, both words next, one word last");
  assert.deepEqual(searchTitles(rows, "invoices").map((found) => found.id), [5, 4, 2], '"invoices" also finds "invoice"');
  assert.deepEqual(searchTitles(rows, "payroll"), []);
  assert.deepEqual(searchTitles(rows, "  ,. "), [], "a query without words finds nothing");
});

test("an entry is matched by the words of the query it has", () => {
  const terms = termsOf("Invoice export, invoice PAYROLL");
  assert.deepEqual(terms, ["invoice", "export", "payroll"], "each word once, in lower case");
  assert.equal(matched("Added the tax id column to the invoices export.", terms), 2);
  assert.equal(matched("Rotated the staging certificate.", terms), 0);
  assert.equal(matched("ws-12 is done", termsOf("12")), 1, "numbers are words too");
});

test("words are split on anything that is not a letter or a digit, in any language", () => {
  assert.deepEqual(tokenize("Exportación de facturas: ¿envío el 28?"), ["exportación", "de", "facturas", "envío", "el", "28"]);
});
