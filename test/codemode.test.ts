import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, textOf } from "./helpers.ts";

test("every conversation is sent the same prompt section", async () => {
  const t = await setup();
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  try {
    await t.say(a, "hello");
    await t.say(b, "hello");
    assert.equal(t.systems.length, 2);
    assert.ok(t.systems[0]!.includes("You are one of several conversations"), "the section is in the system prompt");
    // Each system message carries the time it was built; everything else must be word for word the same.
    const timeless = (system: string) => system.replace(/"timestamp":\d+/g, "");
    assert.equal(timeless(t.systems[0]!), timeless(t.systems[1]!), "the same text, so a fork can read the provider cache of its parent");
    assert.ok(!t.systems[0]!.includes(`conversation ${a.id}`), "the section does not name the conversation");
  } finally {
    await t.close();
  }
});

test("with codemodeOnly the tools are reached from scripts, and a refusal does not end the script", async () => {
  const t = await setup({ codemodeOnly: true }, { codemode: true });
  const [a] = t.conversations;
  try {
    const code = [
      `console.log(await tools.hivemind_read({ workstream: "ws-4" }));`,
      `console.log(await tools.hivemind_open({ title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." }));`,
      `console.log(await tools.hivemind_list({}));`,
    ].join("\n");
    await t.say(a!, `call codemode ${JSON.stringify({ code })}`);
    const output = (await t.messages(a!)).map(textOf).find((text) => text.includes("Script completed"))!;
    assert.match(output, /There is no workstream ws-4\./, "the refusal came back as text");
    assert.match(output, /Opened ws-1 · Bulk invoice export\./, "and the script went on");
    assert.match(output, /1 open workstreams, most recently updated first\./);

    const system = t.systems[0]!;
    for (const name of ["hivemind_list", "hivemind_read", "hivemind_open", "hivemind_update", "hivemind_message", "hivemind_whoami"]) {
      assert.ok(system.includes(name), `${name} is declared for scripts`);
    }
    assert.match(await t.call(a!, "hivemind_list", {}), /hivemind_list/, "the model cannot call a tool directly; it is told the tool is not available");
  } finally {
    await t.close();
  }
});
