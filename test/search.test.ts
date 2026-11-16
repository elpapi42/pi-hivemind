import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexRow } from "../src/index.ts";
import { search, tokenize } from "../src/search.ts";
import { setup } from "./helpers.ts";

const row = (id: number, title: string, description: string, extra: Partial<IndexRow> = {}): IndexRow => ({ id, title, status: "open", description, updatedAt: id, involved: [], ...extra });

test("search ranks by how many words of the query match, then by where and how often", () => {
  const rows = [
    row(1, "Login page redesign", "New layout for the sign-in screen."),
    row(2, "Bulk invoice export", "CSV export for finance."),
    row(3, "Finance dashboard", "Shows invoices by month. Export is out of scope."),
    row(4, "Invoice numbering bug", "Two invoices got the same number."),
  ];
  assert.deepEqual(search(rows, "invoice export").map((found) => found.id), [2, 3, 4], "both words in the title first, both in the text next, one word last");
  assert.deepEqual(search(rows, "invoices").map((found) => found.id), [4, 2, 3], '"invoices" also finds "invoice"; title and text beat title alone, which beats text alone');
  assert.deepEqual(search(rows, "payroll"), []);
  assert.deepEqual(search(rows, "  ,. "), [], "a query without words finds nothing");
});

test("search reads the closing summary, and prefers the newer of two equal matches", () => {
  const rows = [
    row(1, "Checkout incident", "Payments failed for an hour.", { status: "done", summary: "Root cause: an expired certificate." }),
    row(2, "Certificate rotation", "Rotate before expiry."),
    row(3, "Certificate rotation", "Rotate before expiry."),
  ];
  assert.deepEqual(search(rows, "certificate").map((found) => found.id), [3, 2, 1]);
  assert.deepEqual(tokenize("Señal: fix-123, API v2!"), ["señal", "fix", "123", "api", "v2"]);
});

test("a query finds done workstreams too, opening one names open workstreams with similar titles, and logs are not searched", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open", { title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." });
    await t.call(a, "hivemind_update", { workstream: "ws-1", status: "done", summary: "Shipped with a tax id column.", log: "Chose semicolons as separators." });
    await t.call(a, "hivemind_open", { title: "Login page redesign", description: "New layout for the sign-in screen.", involvement: "Designs it." });

    const found = await t.call(b, "hivemind_list", { query: "tax export" });
    assert.match(found, /1 workstreams match "tax export", best match first\./);
    assert.match(found, /ws-1 · Bulk invoice export · done/);
    assert.match(await t.call(b, "hivemind_list", { query: "export", status: "open" }), /No open workstreams match "export"\./);
    assert.match(await t.call(b, "hivemind_list", { query: "semicolons" }), /The search reads titles, descriptions and closing summaries, not logs/);
    assert.match(await t.call(b, "hivemind_list", { conversation: Number(b.id), status: "all" }), new RegExp(`The blackboard has no workstreams that involve conversation ${b.id}\\.`));
    assert.match(await t.call(b, "hivemind_list", { conversation: Number(a.id), status: "all" }), /2 workstreams that involve conversation/);

    const duplicate = await t.call(b, "hivemind_open", { title: "Redesign of the login page", description: "Same idea.", involvement: "Asked to do it." });
    assert.match(duplicate, /Opened ws-3 · Redesign of the login page\./);
    assert.match(duplicate, /Open workstreams with similar titles:\n- ws-2 · Login page redesign\nIf one of them is the same work, mark ws-3 done/);
    assert.ok(!duplicate.includes("ws-1 ·"), "a done workstream is not offered as a duplicate");
  } finally {
    await t.close();
  }
});
