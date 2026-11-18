import assert from "node:assert/strict";
import { test } from "node:test";
import type { Found } from "../src/log.ts";
import { setup } from "./helpers.ts";

test("an entry one conversation writes is read by the others", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    assert.equal(await t.call(b, "hivemind_read_log", {}), "The log is empty.");
    assert.equal(await t.call(a, "hivemind_write_log", { text: "Ana from finance asks when the invoice export ships.  I am checking." }), "Wrote entry 1.");
    assert.equal(await t.call(b, "hivemind_write_log", { text: "Told Luis that the test database is refreshed every night." }), "Wrote entry 2.");

    const read = await t.call(b, "hivemind_read_log", {});
    const lines = read.split("\n");
    assert.equal(lines[0], "2 entries, oldest first. The log has 2.");
    assert.match(lines[2]!, new RegExp(`^1 · \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d · conversation ${a.id} · Ana from finance asks when the invoice export ships\\. I am checking\\.$`), "spaces are folded");
    assert.match(lines[3]!, new RegExp(`^2 · .* · conversation ${b.id} \\(you\\) · Told Luis`), "the reader's own entry is marked");

    assert.deepEqual((await t.page(0))!.entries.map((entry) => entry.by), [a.id, b.id]);
    assert.deepEqual((await t.piece(0))!.pages[0]!.conversations, [a.id, b.id], "the directory names who wrote on the page");
    assert.equal((await t.index())!.lastPage, 0);
  } finally {
    await t.close();
  }
});

test("an entry is refused when it is empty, too long, or about a workstream that does not exist", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    assert.match(await t.call(a!, "hivemind_write_log", { text: "  " }), /`text` is empty/);
    assert.equal(
      await t.call(a!, "hivemind_write_log", { text: "x".repeat(241) }),
      "The entry is too long: `text` has 241 characters, and the most is 200. An entry holds one fact: shorten it, or split it into two entries, and write it again. Nothing was written to the log.",
      "the refusal names the length that was sent and the most allowed",
    );
    assert.match(await t.call(a!, "hivemind_write_log", { text: "Backend merged.", workstream: "ws-3" }), /There is no workstream ws-3\./);
    assert.match(await t.call(a!, "hivemind_write_log", { text: "Backend merged.", workstream: "invoices" }), /must be a workstream id such as "ws-12"/);
    assert.equal((await t.index())?.lastPage ?? -1, -1, "nothing was written");
    assert.equal(await t.call(a!, "hivemind_write_log", { text: "x".repeat(200) }), "Wrote entry 1.");
    // A model cannot count characters exactly, so an entry a little over is kept, with a warning.
    assert.equal(await t.call(a!, "hivemind_write_log", { text: "x".repeat(215) }), "Wrote entry 2. The entry has 215 characters. The most is 200: write shorter entries.");
    assert.match(await t.call(a!, "hivemind_read_log", { limit: 0 }), /`limit` must be a number of entries/);
    assert.match(await t.call(a!, "hivemind_read_log", { from: "yesterday" }), /`from` must be a time such as/);
    assert.match(await t.call(a!, "hivemind_read_log", { from: "2026-11-18", to: "2026-11-17" }), /`from` is later than `to`/);
    assert.match(await t.call(a!, "hivemind_read_log", { workstream: "ws-9" }), /There is no workstream ws-9\./);
  } finally {
    await t.close();
  }
});

test("the log is stored in pages, and an entry's number gives its page", async () => {
  const t = await setup({ pageSize: 3, piecePages: 2, readLimit: 5 });
  try {
    for (let i = 1; i <= 8; i++) assert.equal(await t.write(i % 2 === 0 ? 20 : 10, `Step ${i}.`, 1000 + i), i);
    const index = (await t.index())!;
    assert.deepEqual([index.pageSize, index.piecePages, index.lastPage], [3, 2, 2]);
    assert.deepEqual((await t.page(0))!.entries.map((entry) => entry.text), ["Step 1.", "Step 2.", "Step 3."]);
    assert.deepEqual((await t.page(2))!.entries.map((entry) => entry.text), ["Step 7.", "Step 8."]);
    assert.equal(await t.page(3), undefined);
    assert.deepEqual((await t.piece(0))!.pages.map((row) => row.from), [1001, 1004], "a directory piece covers two pages, each with the time of its first entry");
    assert.deepEqual((await t.piece(1))!.pages, [{ from: 1007, conversations: [10, 20] }]);

    const newest = await t.read();
    assert.deepEqual(newest.entries.map((entry) => entry.n), [4, 5, 6, 7, 8], "the newest entries, oldest first");
    assert.deepEqual([newest.total, newest.older], [8, 4]);
    const older = await t.read({ before: newest.older! });
    assert.deepEqual(older.entries.map((entry) => entry.text), ["Step 1.", "Step 2.", "Step 3."]);
    assert.equal(older.older, undefined, "the start of the log was reached");
    assert.deepEqual((await t.read({ before: 1 })).entries, []);
  } finally {
    await t.close();
  }
});

test("the size of a page is fixed when the log is created", async () => {
  const t = await setup({ pageSize: 3 });
  try {
    await t.write(10, "First.", 1);
    assert.equal((await t.index())!.pageSize, 3);
  } finally {
    await t.close();
  }
});

test("an entry never gets an earlier time than the one before it", async () => {
  const t = await setup({ pageSize: 2 });
  try {
    await t.write(10, "Later clock.", 5000);
    await t.write(20, "Earlier clock.", 4000);
    await t.write(20, "Next page.", 4500);
    assert.deepEqual((await t.read()).entries.map((entry) => entry.at), [5000, 5000, 5000]);
    assert.equal((await t.piece(0))!.pages[1]!.from, 5000);
  } finally {
    await t.close();
  }
});

test("the log is filtered by conversation, by workstream, by time and by words", async () => {
  const t = await setup({ pageSize: 3, piecePages: 2 });
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open_workstream", { title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." });
    const start = (await t.page(0))!.entries[0]!.at;
    const at = (minutes: number) => start + minutes * 60_000;
    await t.write(10, "Ana from finance asks when the invoice export ships.", at(1), 1);
    await t.write(20, "Told Luis that the test database is refreshed every night.", at(2));
    await t.write(20, "Rotated the staging certificate.", at(3));
    await t.write(20, "Checked the certificate on the mail server.", at(4));
    await t.write(20, "Renewed the domain.", at(5));
    await t.write(10, "Added the tax id column to the invoice export.", at(6), 1);
    await t.write(30, "Finance closes the month on the 28th.", at(7));
    const texts = (found: { entries: Found[] }) => found.entries.map((entry) => entry.text);

    assert.deepEqual(texts(await t.read({ conversation: 10 })), ["Ana from finance asks when the invoice export ships.", "Added the tax id column to the invoice export."]);
    assert.deepEqual((await t.piece(0))!.pages[1]!.conversations, [20], "the page in between is passed by: the directory says conversation 10 is not on it");

    assert.deepEqual((await t.workstream(1))!.pages, [0, 2], "the workstream names the pages of its entries");
    assert.deepEqual(texts(await t.read({ workstream: 1 })), ["Opened ws-1: Bulk invoice export", "Ana from finance asks when the invoice export ships.", "Added the tax id column to the invoice export."]);
    assert.deepEqual(texts(await t.read({ workstream: 1, before: 7 })), ["Opened ws-1: Bulk invoice export", "Ana from finance asks when the invoice export ships."]);
    assert.deepEqual(texts(await t.read({ workstream: 1, conversation: 10, query: "tax" })), ["Added the tax id column to the invoice export."]);

    assert.deepEqual(texts(await t.read({ from: at(3), to: at(5) })), ["Rotated the staging certificate.", "Checked the certificate on the mail server.", "Renewed the domain."]);
    assert.deepEqual(texts(await t.read({ to: at(2) })).slice(1), ["Ana from finance asks when the invoice export ships.", "Told Luis that the test database is refreshed every night."]);
    assert.deepEqual(texts(await t.read({ from: at(7) })), ["Finance closes the month on the 28th."]);
    assert.deepEqual(texts(await t.read({ to: start - 1 })), [], "before the log began");
    assert.deepEqual(texts(await t.read({ from: at(60) })), []);

    assert.deepEqual(texts(await t.read({ query: "certificates" })), ["Rotated the staging certificate.", "Checked the certificate on the mail server."], '"certificates" also finds "certificate"');
    const both = await t.read({ query: "finance invoice" });
    assert.deepEqual(texts(both), ["Ana from finance asks when the invoice export ships."], "an entry with every word wins over entries with one");
    assert.equal(both.matchedWords, undefined);
    const most = await t.read({ query: "invoice export payroll" });
    assert.deepEqual(texts(most), ["Opened ws-1: Bulk invoice export", "Ana from finance asks when the invoice export ships.", "Added the tax id column to the invoice export."]);
    assert.equal(most.matchedWords, 2, "no entry has every word, so the ones with the most are given");
    assert.deepEqual(texts(await t.read({ query: "payroll" })), []);

    const told = await t.call(a!, "hivemind_read_log", { query: "invoice export payroll", limit: 2 });
    assert.match(told, /^2 entries that match, oldest first\. The log has 8\. No entry has every word of the query; these have 2 of them\./);
    assert.match(told, /Call hivemind_read_log with the same arguments and before 2 to read on\./);
    assert.match(told, / · ws-1 · Added the tax id column/, "an entry names its workstream");
  } finally {
    await t.close();
  }
});

test("a read opens a limited number of pages, and reading on from where it stopped finds every entry once", async () => {
  const t = await setup({ pageSize: 4, piecePages: 3, scanPages: 2 });
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open_workstream", { title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." });
    const words = ["invoice", "export", "certificate", "finance", "database"];
    const written: Found[] = [{ ...(await t.read()).entries[0]! }];
    for (let i = 0; i < 60; i++) {
      const by = [10, 20, 30][(i * 7) % 3]!;
      const about = i % 5 === 0 ? 1 : undefined;
      const text = `${words[i % 5]} ${words[(i * 3) % 5]} note ${i}`;
      const at = written[0]!.at + (i + 1) * 1000;
      const n = await t.write(by, text, at, about);
      written.push({ n, at, by, text, ...(about === undefined ? {} : { workstream: about }) });
    }
    const all = async (query: Parameters<typeof t.read>[0]) => {
      const found: Found[] = [];
      let before: number | undefined;
      for (let calls = 0; calls < 100; calls++) {
        const part = await t.read({ limit: 5, ...query, ...(before === undefined ? {} : { before }) });
        found.unshift(...part.entries);
        if (part.older === undefined) return found;
        before = part.older;
      }
      throw new Error("the read never reached the start of the log");
    };
    const first = written[0]!.at;
    assert.deepEqual(await all({}), written);
    assert.deepEqual(await all({ conversation: 20 }), written.filter((entry) => entry.by === 20));
    assert.deepEqual(await all({ workstream: 1 }), written.filter((entry) => entry.workstream === 1));
    assert.deepEqual(await all({ from: first + 10_000, to: first + 40_000 }), written.filter((entry) => entry.at >= first + 10_000 && entry.at <= first + 40_000));
    assert.deepEqual(await all({ query: "certificate" }), written.filter((entry) => entry.text.includes("certificate")));
    assert.deepEqual(await all({ conversation: 30, query: "database", to: first + 50_000 }), written.filter((entry) => entry.by === 30 && entry.text.includes("database") && entry.at <= first + 50_000));

    const one = await t.read({ query: "certificate", limit: 50 });
    // 61 entries in pages of four: page 15 holds entry 61, page 14 holds 57 to 60.
    assert.ok(one.entries.length > 0 && one.entries.every((entry) => entry.n >= 57), "one read opened two pages");
    assert.equal(one.older, 57);
  } finally {
    await t.close();
  }
});
