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
    const opened = await t.call(a, "hivemind_open", EXPORT);
    assert.match(opened, new RegExp(`^You are conversation ${a.id}\\.`), "every answer starts with the caller's id");
    assert.match(opened, /Opened ws-1 · Bulk invoice export\. You are recorded as involved\./);

    const list = await t.call(b, "hivemind_list", {});
    assert.match(list, new RegExp(`^You are conversation ${b.id}\\.`));
    assert.match(list, /1 open workstreams, most recently updated first\./);
    assert.match(list, /ws-1 · Bulk invoice export · open/);
    assert.match(list, new RegExp(`involved: ${a.id}\\n`), "the other conversation is listed, and not marked as the reader");
    assert.match(list, /CSV export for finance/);

    const read = await t.call(b, "hivemind_read", { workstream: "ws-1" });
    assert.match(read, /You are not involved in this workstream\./);
    assert.match(read, new RegExp(`- conversation ${a.id}, since \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}: Plans and implements the feature\\.`));
    assert.match(read, new RegExp(`1\\. \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} · conversation ${a.id} · Opened\\.`));

    const own = await t.call(a, "hivemind_list", {});
    assert.match(own, new RegExp(`involved: ${a.id} \\(you\\)`));
  } finally {
    await t.close();
  }
});

test("a conversation must say why it is involved before it changes a workstream", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open", EXPORT);

    const refused = await t.call(b, "hivemind_update", { workstream: "ws-1", log: "Finance also needs the tax id on every row." });
    assert.match(refused, /You are not yet involved in ws-1\. Pass `involvement`/);
    assert.equal((await t.workstream(1))!.log.length, 1, "a refused update changes nothing");

    const joined = await t.call(b, "hivemind_update", {
      workstream: 1,
      log: "Finance also needs the tax id on every row.",
      involvement: "Relayed a requirement from a person in finance.",
    });
    assert.match(joined, /ws-1 · Bulk invoice export: recorded you as involved and added log entry 2\./);

    const workstream = (await t.workstream(1))!;
    assert.deepEqual(Object.keys(workstream.involved).map(Number).sort(), [a.id, b.id].map(Number).sort());
    assert.equal(workstream.involved[String(b.id)]!.text, "Relayed a requirement from a person in finance.");
    assert.equal(workstream.log[1]!.by, b.id);
    assert.deepEqual([...(await t.index())!.rows["1"]!.involved].sort(), [a.id, b.id].map(Number).sort(), "the index row follows");

    // Once involved, a log entry alone is enough.
    assert.match(await t.call(b, "hivemind_update", { workstream: "ws-1", log: "Told the implementer." }), /added log entry 3\./);
  } finally {
    await t.close();
  }
});

test("the description is a snapshot that is replaced, and the index holds the new text", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open", EXPORT);
    const answer = await t.call(a!, "hivemind_update", { workstream: "ws-1", description: "Backend merged. The screen is in review.", log: "Backend merged." });
    assert.match(answer, /rewrote the description and added log entry 2\./);
    assert.equal((await t.workstream(1))!.description, "Backend merged. The screen is in review.");
    assert.equal((await t.index())!.rows["1"]!.description, "Backend merged. The screen is in review.");
    assert.match(await t.call(a!, "hivemind_list", {}), /Backend merged\. The screen is in review\./);
  } finally {
    await t.close();
  }
});

test("marking done needs a closing summary, and a done workstream stays on the blackboard", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open", EXPORT);
    assert.match(await t.call(a, "hivemind_update", { workstream: "ws-1", status: "done" }), /Marking ws-1 done needs `summary`/);
    assert.match(await t.call(a, "hivemind_update", { workstream: "ws-1", summary: "Shipped." }), /`summary` is the closing summary of a done workstream/);

    const closed = await t.call(a, "hivemind_update", { workstream: "ws-1", status: "done", summary: "Shipped the export with the tax id column. Finance confirmed it." });
    assert.match(closed, /marked it done\./);
    const workstream = (await t.workstream(1))!;
    assert.equal(workstream.status, "done");
    assert.equal(workstream.log[workstream.log.length - 1]!.text, "Marked done.");

    assert.match(await t.call(b, "hivemind_list", {}), /The blackboard has no open workstreams\./);
    const done = await t.call(b, "hivemind_list", { status: "done" });
    assert.match(done, /ws-1 · Bulk invoice export · done/);
    assert.match(done, /Closing summary: Shipped the export with the tax id column/);
    assert.match(await t.call(b, "hivemind_read", { workstream: "ws-1" }), /Closing summary:\nShipped the export with the tax id column\. Finance confirmed it\./);

    // Reopening keeps the old summary in the log.
    assert.match(await t.call(a, "hivemind_update", { workstream: "ws-1", status: "open", log: "Finance found rows without a tax id." }), /added log entry 3 and reopened it\./);
    const reopened = (await t.workstream(1))!;
    assert.equal(reopened.status, "open");
    assert.equal(reopened.summary, undefined);
    assert.match(reopened.log[reopened.log.length - 1]!.text, /^Reopened\. The closing summary was: Shipped the export/);
    assert.match(await t.call(b, "hivemind_list", {}), /ws-1 · Bulk invoice export · open/);
  } finally {
    await t.close();
  }
});

test("the tools refuse what cannot be done, and say why", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    assert.match(await t.call(a!, "hivemind_read", { workstream: "ws-9" }), /There is no workstream ws-9\./);
    assert.match(await t.call(a!, "hivemind_update", { workstream: "ws-9", log: "x", involvement: "y" }), /There is no workstream ws-9\./);
    assert.deepEqual(Object.keys((await t.index())?.rows ?? {}), [], "asking for a missing workstream creates nothing");
    assert.equal(await t.workstream(9), undefined);
    assert.match(await t.call(a!, "hivemind_read", { workstream: "invoices" }), /must be a workstream id such as "ws-12"/);
    assert.match(await t.call(a!, "hivemind_open", { ...EXPORT, title: "  " }), /are all needed, and none may be empty/);
    assert.match(await t.call(a!, "hivemind_open", { ...EXPORT, title: "x".repeat(200) }), /`title` has 200 characters; the most is 120\./);
    await t.call(a!, "hivemind_open", EXPORT);
    assert.match(await t.call(a!, "hivemind_update", { workstream: "ws-1" }), /Pass at least one of/);
    assert.match(await t.call(a!, "hivemind_update", { workstream: "ws-1", status: "open" }), /Nothing would change: ws-1 is already open\./);
  } finally {
    await t.close();
  }
});

test("the log is read a page at a time, newest first", async () => {
  const t = await setup({ logPage: 3 });
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open", EXPORT);
    for (let i = 2; i <= 7; i++) await t.call(a!, "hivemind_update", { workstream: "ws-1", log: `Step ${i}.` });
    const newest = await t.call(a!, "hivemind_read", { workstream: "ws-1" });
    assert.match(newest, /Log \(entries 5 to 7 of 7\):/);
    assert.match(newest, /7\. .* · Step 7\./);
    assert.ok(!newest.includes("Step 4."));
    assert.match(newest, /Call hivemind_read with before 5 to see them\./);
    const older = await t.call(a!, "hivemind_read", { workstream: "ws-1", before: 5 });
    assert.match(older, /Log \(entries 2 to 4 of 7\):/);
    const oldest = await t.call(a!, "hivemind_read", { workstream: "ws-1", before: 2 });
    assert.match(oldest, /Log \(entries 1 to 1 of 7\):/);
    assert.ok(!oldest.includes("Older entries exist"));
  } finally {
    await t.close();
  }
});
