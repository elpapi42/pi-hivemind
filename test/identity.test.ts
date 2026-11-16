import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, textOf } from "./helpers.ts";

const EXPORT = { title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Plans and implements the feature." };

test("a conversation asks who it is, and is told its id and what it is involved in", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    assert.equal(await t.call(b, "hivemind_whoami", {}), `You are conversation ${b.id}.\n\nYou are not involved in any workstream.`);

    await t.call(a, "hivemind_open", EXPORT);
    await t.call(a, "hivemind_open", { title: "Login page redesign", description: "New layout.", involvement: "Designs it." });
    await t.call(a, "hivemind_update", { workstream: "ws-2", status: "done", summary: "Shipped." });
    await t.call(a, "hivemind_open", { title: "Certificate rotation", description: "Rotate before expiry.", involvement: "Does it." });
    assert.equal(
      await t.call(a, "hivemind_whoami", {}),
      [
        `You are conversation ${a.id}.`,
        "",
        "You are involved in these workstreams:",
        "- ws-3 · Certificate rotation · open",
        "- ws-1 · Bulk invoice export · open",
        "- ws-2 · Login page redesign · done",
      ].join("\n"),
      "open ones first",
    );
  } finally {
    await t.close();
  }
});

test("a copy of a conversation remembers the original's work, and is told that it is another conversation", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    await t.call(a!, "hivemind_open", EXPORT);
    await t.call(a!, "hivemind_whoami", {});
    const copy = await t.fork(a!);
    assert.notEqual(copy.id, a!.id);
    assert.ok((await t.messages(copy)).map(textOf).includes(`You are conversation ${a!.id}.\n\nYou are involved in this workstream:\n- ws-1 · Bulk invoice export · open`), "the copy starts with the original's id in its context");

    assert.equal(
      await t.call(copy, "hivemind_whoami", {}),
      [
        `You are conversation ${copy.id}.`,
        `This conversation started as a copy of conversation ${a!.id}. What you remember from before the copy was done by conversation ${a!.id}, and the blackboard records it under ${a!.id}, not under you.`,
        "",
        "You are not involved in any workstream.",
        "",
        `Conversation ${a!.id} is involved in:`,
        "- ws-1 · Bulk invoice export · open",
      ].join("\n"),
    );

    // The blackboard marks the original, not the copy, and a change by the copy is not taken for the original's.
    assert.match(await t.call(copy, "hivemind_list", {}), new RegExp(`involved: ${a!.id}\\n`));
    const refused = await t.call(copy, "hivemind_update", { workstream: "ws-1", log: "Backend merged." });
    assert.match(refused, new RegExp(`You are not yet involved in ws-1\\. You may remember being part of it: that was conversation ${a!.id}, which this conversation started as a copy of\\. You are conversation ${copy.id}\\. Pass \`involvement\``));

    await t.call(copy, "hivemind_update", { workstream: "ws-1", log: "Answered a question about the columns.", involvement: "Answers follow-up questions in a side thread." });
    const workstream = (await t.workstream(1))!;
    assert.equal(workstream.log[1]!.by, copy.id, "what the copy writes is recorded under the copy");
    assert.deepEqual(Object.keys(workstream.involved).map(Number).sort((x, y) => x - y), [Number(a!.id), Number(copy.id)].sort((x, y) => x - y));
  } finally {
    await t.close();
  }
});
