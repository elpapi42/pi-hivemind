import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, textOf } from "./helpers.ts";

const EXPORT = { title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Plans and implements the feature." };

test("a conversation asks who it is, and is told its id and what it is involved in", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    assert.equal(await t.call(b, "hivemind_whoami", {}), `You are conversation ${b.id}.\n\nYou are not involved in any open workstream.`);

    await t.call(a, "hivemind_open_workstream", EXPORT);
    await t.call(a, "hivemind_open_workstream", { title: "Login page redesign", description: "New layout.", involvement: "Designs it." });
    await t.call(a, "hivemind_update_workstream", { workstream: "ws-2", status: "done", summary: "Shipped." });
    await t.call(a, "hivemind_open_workstream", { title: "Certificate rotation", description: "Rotate before expiry.", involvement: "Does it." });
    assert.equal(
      await t.call(a, "hivemind_whoami", {}),
      [
        `You are conversation ${a.id}.`,
        "",
        "You are involved in these open workstreams:",
        "- ws-3 · Certificate rotation",
        "- ws-1 · Bulk invoice export",
      ].join("\n"),
      "the done one is not listed",
    );
  } finally {
    await t.close();
  }
});

test("a copy of a conversation remembers the original's work, and is told that it is another conversation", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open_workstream", EXPORT);
    await t.call(a!, "hivemind_whoami", {});
    const copy = await t.fork(a!);
    assert.notEqual(copy.id, a!.id);
    assert.ok((await t.messages(copy)).map(textOf).includes(`You are conversation ${a!.id}.\n\nYou are involved in this open workstream:\n- ws-1 · Bulk invoice export`), "the copy starts with the original's id in its context");

    assert.equal(
      await t.call(copy, "hivemind_whoami", {}),
      [
        `You are conversation ${copy.id}.`,
        `This conversation started as a copy of conversation ${a!.id}. What you remember from before the copy was done by conversation ${a!.id}, and the log and the workstreams record it under ${a!.id}, not under you.`,
        "",
        "You are not involved in any open workstream.",
        "",
        `Conversation ${a!.id} is involved in:`,
        "- ws-1 · Bulk invoice export",
      ].join("\n"),
    );

    // The workstream marks the original, not the copy, and a change by the copy is not taken for the original's.
    assert.match(await t.call(copy, "hivemind_list_workstreams", {}), new RegExp(`involved: ${a!.id}\\n`));
    const refused = await t.call(copy, "hivemind_update_workstream", { workstream: "ws-1", description: "Backend merged." });
    assert.match(refused, new RegExp(`You are not yet involved in ws-1\\. You may remember being part of it: that was conversation ${a!.id}, which this conversation started as a copy of\\. You are conversation ${copy.id}\\. Pass \`involvement\``));

    await t.call(copy, "hivemind_write_log", { text: "Answered a question about the columns.", workstream: "ws-1" });
    assert.equal((await t.read({ workstream: 1 })).entries.at(-1)!.by, copy.id, "what the copy writes is recorded under the copy");
    await t.call(copy, "hivemind_update_workstream", { workstream: "ws-1", involvement: "Answers follow-up questions in a side thread." });
    const workstream = (await t.workstream(1))!;
    assert.deepEqual(Object.keys(workstream.involved).map(Number).sort((x, y) => x - y), [Number(a!.id), Number(copy.id)].sort((x, y) => x - y));
  } finally {
    await t.close();
  }
});
