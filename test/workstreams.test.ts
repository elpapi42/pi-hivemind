import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.ts";

const EXPORT = {
  title: "Bulk invoice export",
  description: "CSV export for finance. Backend first, then the screen.",
  involvement: "Plans and implements the feature.",
};

test("a workstream one conversation opens is seen by the others, with who is involved and why", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    const opened = await t.call(a, "hivemind_open_workstream", EXPORT);
    assert.match(opened, /^Opened ws-1 · Bulk invoice export\. You are recorded as involved\./);
    assert.ok(!opened.includes(`conversation ${a.id}`), "an answer does not state the caller's id");

    const list = await t.call(b, "hivemind_list_workstreams", {});
    assert.match(list, /1 open workstreams, most recently changed first\./);
    assert.match(list, /ws-1 · Bulk invoice export\n/);
    assert.match(list, new RegExp(`involved: ${a.id}\\n`), "the other conversation is listed, and not marked as the reader");
    assert.match(list, /CSV export for finance/);

    const read = await t.call(b, "hivemind_read_workstream", { workstream: "ws-1" });
    assert.match(read, /You are not involved in this workstream\./);
    assert.match(read, new RegExp(`- conversation ${a.id}, since \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}: Plans and implements the feature\\.`));
    assert.match(read, new RegExp(`\\n1 · \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} · conversation ${a.id} · Opened ws-1: Bulk invoice export$`), "opening wrote the first entry of its history");
    assert.match(await t.call(b, "hivemind_read_log", {}), / · ws-1 · Opened ws-1: Bulk invoice export$/, "and the whole hive reads it in the log");

    const own = await t.call(a, "hivemind_list_workstreams", {});
    assert.match(own, new RegExp(`involved: ${a.id} \\(you\\)`));
  } finally {
    await t.close();
  }
});

test("any conversation writes an entry about a workstream, but changing the workstream needs a part in it", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open_workstream", EXPORT);

    assert.equal(await t.call(b, "hivemind_write_log", { text: "Finance also needs the tax id on every row.", workstream: "ws-1" }), "Wrote entry 2 about ws-1.");
    assert.deepEqual(Object.keys((await t.workstream(1))!.involved).map(Number), [Number(a.id)], "an entry gives no part in the work");
    assert.match(await t.call(a, "hivemind_read_workstream", { workstream: 1 }), new RegExp(`2 · .* · conversation ${b.id} · Finance also needs the tax id on every row\\.`));

    const refused = await t.call(b, "hivemind_update_workstream", { workstream: "ws-1", description: "Needs the tax id too." });
    assert.match(refused, /You are not yet involved in ws-1\. Pass `involvement`.*write a log entry with hivemind_write_log instead\./);
    assert.equal((await t.workstream(1))!.description, EXPORT.description, "a refused update changes nothing");

    const joined = await t.call(b, "hivemind_update_workstream", { workstream: 1, involvement: "Relays what finance needs." });
    assert.match(joined, /ws-1 · Bulk invoice export: recorded you as involved\./);
    const workstream = (await t.workstream(1))!;
    assert.deepEqual(Object.keys(workstream.involved).map(Number).sort(), [a.id, b.id].map(Number).sort());
    assert.equal(workstream.involved[String(b.id)]!.text, "Relays what finance needs.");
    assert.deepEqual([...(await t.index())!.open["1"]!.involved].sort(), [a.id, b.id].map(Number).sort(), "the index row follows");

    // Once involved, a description alone is enough.
    assert.match(await t.call(b, "hivemind_update_workstream", { workstream: "ws-1", description: "Needs the tax id too." }), /rewrote the description\./);
  } finally {
    await t.close();
  }
});

test("the description is a snapshot that is replaced, and the index holds no copy of it", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open_workstream", EXPORT);
    const answer = await t.call(a!, "hivemind_update_workstream", { workstream: "ws-1", description: "Backend merged. The screen is in review." });
    assert.match(answer, /rewrote the description\./);
    assert.equal((await t.workstream(1))!.description, "Backend merged. The screen is in review.");
    assert.deepEqual(Object.keys((await t.index())!.open["1"]!).sort(), ["id", "involved", "title", "updatedAt"]);
    assert.match(await t.call(a!, "hivemind_list_workstreams", {}), /Backend merged\. The screen is in review\./);
    assert.equal((await t.read()).entries.length, 1, "rewriting the description writes no entry");
  } finally {
    await t.close();
  }
});

test("a workstream is marked done with its outcome, which is the closing entry in the log", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open_workstream", EXPORT);
    assert.match(await t.call(a, "hivemind_update_workstream", { workstream: "ws-1", status: "done" }), /Marking ws-1 done needs `outcome`: one fact that says how the work ended\./);
    assert.match(await t.call(a, "hivemind_update_workstream", { workstream: "ws-1", outcome: "Shipped." }), /`outcome` goes with `status` "done"/);
    assert.match(
      await t.call(a, "hivemind_update_workstream", { workstream: "ws-1", status: "done", outcome: "x".repeat(241) }),
      /The outcome is too long: `outcome` has 241 characters, and the most is 200\..* Nothing changed\./,
    );
    assert.equal((await t.workstream(1))!.status, "open", "a refused closing changes nothing");

    const closed = await t.call(a, "hivemind_update_workstream", { workstream: "ws-1", status: "done", outcome: "Shipped the export with the tax id column.  Finance confirmed the file." });
    assert.match(closed, /ws-1 · Bulk invoice export: marked it done and wrote its outcome to the log\.$/);
    const workstream = (await t.workstream(1))!;
    assert.equal(workstream.status, "done");
    assert.equal("summary" in workstream, false, "the end is in the log, not in the document");
    assert.deepEqual((await t.index())!.open, {}, "the index holds only open workstreams");
    assert.equal((await t.index())!.nextWorkstream, 2);

    assert.match(await t.call(b, "hivemind_list_workstreams", {}), /There are no open workstreams\. A workstream that was marked done is not listed: find it in the log/);
    assert.match(await t.call(b, "hivemind_read_log", { query: "invoice export" }), /^1 entry that matches, oldest first\. The log has 2\.\n\n1 · .* · ws-1 · Opened ws-1: Bulk invoice export$/, "the words of its title find its id in the log");
    assert.match(await t.call(b, "hivemind_read_log", { workstream: "ws-1" }), / · ws-1 · Closed ws-1: Shipped the export with the tax id column\. Finance confirmed the file\.$/, "and its entries say how it ended");
    const read = await t.call(b, "hivemind_read_workstream", { workstream: "ws-1" });
    assert.match(read, /^You are not involved in this workstream\.\n\nws-1 · Bulk invoice export · done/);
    assert.match(read, new RegExp(`\\n2 · .* · conversation ${a.id} · Closed ws-1: Shipped the export with the tax id column\\. Finance confirmed the file\\.$`), "a reader of the workstream sees how it ended as its last entry");
    assert.match(await t.call(a, "hivemind_update_workstream", { workstream: "ws-1", status: "done", outcome: "Again." }), /ws-1 is already done\. To add something about it, write a log entry/);

    // An entry written after the end is still part of its history.
    await t.call(b, "hivemind_write_log", { text: "Finance found rows without a tax id in the export.", workstream: 1 });
    assert.match(await t.call(b, "hivemind_read_workstream", { workstream: 1 }), /Finance found rows without a tax id in the export\.$/);

    // Reopening puts it back in the index.
    assert.match(await t.call(a, "hivemind_update_workstream", { workstream: "ws-1", status: "open" }), /reopened it\./);
    const reopened = (await t.workstream(1))!;
    assert.equal(reopened.status, "open");
    assert.equal(reopened.closedAt, undefined);
    assert.equal((await t.index())!.open["1"]!.title, "Bulk invoice export");
    assert.match(await t.call(b, "hivemind_list_workstreams", {}), /ws-1 · Bulk invoice export\n/);

    // It is done a second time with a description for the detail, and an outcome a little over the ceiling is kept.
    const again = await t.call(a, "hivemind_update_workstream", { workstream: 1, status: "done", description: "Shipped. Rows without a tax id are now exported with an empty cell.", outcome: "y".repeat(210) });
    assert.match(again, /rewrote the description and marked it done and wrote its outcome to the log\. The outcome has 210 characters\. The most is 200: write shorter ones\.$/);
    assert.deepEqual(
      (await t.read({ workstream: 1 })).entries.map((entry) => entry.text),
      [
        "Opened ws-1: Bulk invoice export",
        "Closed ws-1: Shipped the export with the tax id column. Finance confirmed the file.",
        "Finance found rows without a tax id in the export.",
        "Reopened ws-1: Bulk invoice export",
        `Closed ws-1: ${"y".repeat(210)}`,
      ],
    );
  } finally {
    await t.close();
  }
});

test("the list is narrowed by the words of a title and by conversation", async () => {
  const t = await setup({ listLimit: 2 });
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open_workstream", EXPORT);
    await t.call(b, "hivemind_open_workstream", { title: "Login page redesign", description: "New layout for invoices of the sign-in screen.", involvement: "Designs it." });
    await t.call(b, "hivemind_open_workstream", { title: "Invoice numbering bug", description: "Two invoices got the same number.", involvement: "Fixes it." });

    const found = await t.call(a, "hivemind_list_workstreams", { query: "invoices export" });
    assert.match(found, /^2 open workstreams match "invoices export", best match first\.\n\nws-1 · Bulk invoice export\n[^]*\n\nws-3 · Invoice numbering bug\n/, "titles only: the description of ws-2 is not searched");
    assert.match(await t.call(a, "hivemind_list_workstreams", { query: "payroll" }), /No open workstreams have "payroll" in the title\./);
    const mine = await t.call(a, "hivemind_list_workstreams", { conversation: Number(b.id) });
    assert.match(mine, new RegExp(`^2 open workstreams that involve conversation ${b.id}, most recently changed first\\.\\n\\nws-3 `));
    assert.match(await t.call(a, "hivemind_list_workstreams", {}), /1 more are not shown\./);
  } finally {
    await t.close();
  }
});

test("the tools refuse what cannot be done, and say why", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    assert.match(await t.call(a!, "hivemind_read_workstream", { workstream: "ws-9" }), /There is no workstream ws-9\./);
    assert.match(await t.call(a!, "hivemind_update_workstream", { workstream: "ws-9", description: "x", involvement: "y" }), /There is no workstream ws-9\./);
    assert.deepEqual((await t.index())?.open ?? {}, {}, "asking for a missing workstream creates nothing");
    assert.equal(await t.workstream(9), undefined);
    assert.match(await t.call(a!, "hivemind_read_workstream", { workstream: "invoices" }), /must be a workstream id such as "ws-12"/);
    assert.match(await t.call(a!, "hivemind_open_workstream", { ...EXPORT, title: "  " }), /are all needed, and none may be empty/);
    assert.match(await t.call(a!, "hivemind_open_workstream", { ...EXPORT, title: "x".repeat(200) }), /`title` has 200 characters; the most is 120\./);
    await t.call(a!, "hivemind_open_workstream", EXPORT);
    assert.match(await t.call(a!, "hivemind_update_workstream", { workstream: "ws-1" }), /Pass at least one of/);
    assert.match(await t.call(a!, "hivemind_update_workstream", { workstream: "ws-1", status: "open" }), /Nothing would change: ws-1 is already open\./);
  } finally {
    await t.close();
  }
});

test("the entries of a workstream are read a few at a time, newest first, from the pages it names", async () => {
  const t = await setup({ workstreamEntries: 3, pageSize: 4 });
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open_workstream", EXPORT);
    for (let i = 2; i <= 7; i++) {
      await t.call(a!, "hivemind_write_log", { text: `Step ${i}.`, workstream: "ws-1" });
      await t.call(a!, "hivemind_write_log", { text: `Something else ${i}.` });
    }
    // 13 entries in pages of four; the last page holds one entry, which is not about the workstream.
    assert.deepEqual((await t.workstream(1))!.pages, [0, 1, 2], "each page once, however many of its entries are there");
    const newest = await t.call(a!, "hivemind_read_workstream", { workstream: "ws-1" });
    assert.match(newest, /Log entries, oldest first:\n8 · .* · Step 5\.\n10 · .* · Step 6\.\n12 · .* · Step 7\.\n\nOlder entries exist\. Call hivemind_read_workstream with before 8 to see them\.$/);
    assert.ok(!newest.includes("Something else"), "only its own entries");
    const older = await t.call(a!, "hivemind_read_workstream", { workstream: "ws-1", before: 8 });
    assert.match(older, /\n2 · .* · Step 2\.\n4 · .* · Step 3\.\n6 · .* · Step 4\.\n\nOlder entries exist\. Call hivemind_read_workstream with before 2/);
    const oldest = await t.call(a!, "hivemind_read_workstream", { workstream: "ws-1", before: 2 });
    assert.match(oldest, /Log entries, oldest first:\n1 · .* · Opened ws-1: Bulk invoice export$/);
  } finally {
    await t.close();
  }
});
