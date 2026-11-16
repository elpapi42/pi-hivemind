import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, textOf } from "./helpers.ts";

test("a message wakes an idle conversation, which reads who sent it, and its answer comes back the same way", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.call(a, "hivemind_open", { title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." });
    // The scripted model obeys "call <tool> <json>" also inside a message, so this asks conversation b to answer.
    const reply = `call hivemind_message ${JSON.stringify({ to: Number(a.id), text: "Backend merged; the screen is in review.", reply: false })}`;
    const sent = await t.call(a, "hivemind_message", { to: Number(b.id), text: reply, reply: true, workstream: "ws-1" });
    assert.match(sent, new RegExp(`Sent to conversation ${b.id}\\. Its answer will arrive later as a message to you`));

    const received = (await t.messages(b)).map(textOf);
    assert.equal(received[0], `<hivemind-message from="${a.id}" workstream="ws-1" reply="expected">\n${reply}\n</hivemind-message>`);
    assert.ok(received.some((text) => text.startsWith(`You are conversation ${b.id}.\n\nSent to conversation ${a.id}.`)), "the woken conversation ran and answered");

    const back = (await t.messages(a)).map(textOf);
    assert.ok(
      back.includes(`<hivemind-message from="${b.id}" reply="not expected">\nBackend merged; the screen is in review.\n</hivemind-message>`),
      "the answer reached the first conversation as a message",
    );
    assert.equal(back[back.length - 1], "Understood.", "and woke it");
  } finally {
    await t.close();
  }
});

test("a message is refused when it has nowhere to go or says too little", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    const text = "Where does the export stand?";
    assert.match(await t.call(a, "hivemind_message", { to: Number(a.id), text, reply: true }), new RegExp(`Conversation ${a.id} is you\\.`));
    assert.match(await t.call(a, "hivemind_message", { to: 987654, text, reply: true }), /There is no conversation 987654\./);
    assert.match(await t.call(a, "hivemind_message", { to: Number(b.id), text, reply: true, workstream: "ws-5" }), /There is no workstream ws-5\./);
    assert.match(await t.call(a, "hivemind_message", { to: Number(b.id), text: " ", reply: true }), /`text` is empty/);
    assert.equal((await t.messages(b)).length, 0, "nothing reached the other conversation");
  } finally {
    await t.close();
  }
});

test("a conversation that a task owns takes no messages", async () => {
  const t = await setup();
  const [a] = t.conversations;
  try {
    const spawned = Number(/spawned (\d+)/.exec(await t.call(a!, "spawn", {}))![1]);
    assert.match(
      await t.call(a!, "hivemind_message", { to: spawned, text: "Hello.", reply: false }),
      new RegExp(`Conversation ${spawned} belongs to a background task of another conversation and does not take messages\\.`),
    );
  } finally {
    await t.close();
  }
});

test("a message to a conversation that is working joins its work after the current tool round", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    const working = t.say(b, "call pause {}");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await t.call(a, "hivemind_message", { to: Number(b.id), text: "Use semicolons as separators.", reply: false });
    await working;

    const seen = (await t.messages(b)).map((message) => `${message.role}: ${textOf(message)}`);
    assert.deepEqual(seen, [
      "user: call pause {}",
      "assistant: [call pause]",
      "toolResult: waited",
      `user: <hivemind-message from="${a.id}" reply="not expected">\nUse semicolons as separators.\n</hivemind-message>`,
      "assistant: Understood.",
    ]);
  } finally {
    await t.close();
  }
});
