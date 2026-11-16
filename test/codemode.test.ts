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

test("with codemodeOnly the tools are reached from scripts, return objects, and a refusal does not end the script", async () => {
  const t = await setup({ codemodeOnly: true }, { codemode: true });
  const [a, b] = t.conversations as [(typeof t.conversations)[0], (typeof t.conversations)[0]];
  /** Run a script in `conversation`; every `show(name, value)` comes back as an object. */
  const run = async (conversation: typeof a, lines: string[]) => {
    const code = [`const show = (name, value) => console.log(name + " " + JSON.stringify(value));`, ...lines].join("\n");
    await t.say(conversation, `call codemode ${JSON.stringify({ code })}`);
    const output = (await t.messages(conversation)).map(textOf).filter((text) => text.includes("Script completed")).at(-1)!;
    return (name: string) => JSON.parse(new RegExp(`^${name} (.*)$`, "m").exec(output)![1]!);
  };
  try {
    const got = await run(a, [
      `show("missing", await tools.hivemind_read({ workstream: "ws-4" }));`,
      `show("opened", await tools.hivemind_open({ title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." }));`,
      `show("twin", await tools.hivemind_open({ title: "Invoice export in bulk", description: "Same?", involvement: "Checks it." }));`,
      `show("updated", await tools.hivemind_update({ workstream: "ws-1", log: "Schema agreed with finance." }));`,
      `show("noop", await tools.hivemind_update({ workstream: "ws-1" }));`,
      `show("list", await tools.hivemind_list({}));`,
      `show("read", await tools.hivemind_read({ workstream: "ws-1" }));`,
      `show("sent", await tools.hivemind_message({ to: ${b.id}, text: "Heads up: I am on the invoice export.", reply: false, workstream: "ws-1" }));`,
      `show("self", await tools.hivemind_message({ to: ${a.id}, text: "hello", reply: false }));`,
      `show("whoami", await tools.hivemind_whoami({}));`,
    ]);

    assert.deepEqual(got("missing"), { you: a.id, error: "There is no workstream ws-4. Call hivemind_list to see the ones that exist." }, "a refusal comes back as the object, and the script goes on");
    assert.deepEqual(got("opened"), { id: "ws-1", similar: [] });
    assert.deepEqual(got("twin"), { id: "ws-2", similar: [{ id: "ws-1", title: "Bulk invoice export" }] });
    assert.equal(got("updated").error, undefined);
    assert.match(got("updated").changed.join(), /^added log entry \d+$/);
    assert.deepEqual(got("noop"), { changed: [], error: "Pass at least one of `log`, `description`, `involvement`, `status` or `summary`." });

    const list = got("list");
    assert.equal(list.you, a.id);
    assert.equal(list.total, 2);
    assert.deepEqual(Object.keys(list.workstreams[0]).sort(), ["description", "id", "involved", "status", "title", "updatedAt"]);
    assert.deepEqual(list.workstreams.map((w: { id: string }) => w.id).sort(), ["ws-1", "ws-2"]);
    assert.deepEqual(list.workstreams[0].involved, [a.id]);
    assert.match(list.workstreams[0].updatedAt, /^\d{4}-\d\d-\d\dT/);

    const read = got("read");
    assert.equal(read.you, a.id);
    assert.equal(read.workstream.title, "Bulk invoice export");
    assert.deepEqual(read.workstream.involved.map((i: { conversation: number; part: string }) => [i.conversation, i.part]), [[a.id, "Implements it."]]);
    const last = read.workstream.log.at(-1);
    assert.equal(last.text, "Schema agreed with finance.");
    assert.equal(last.n, read.workstream.logTotal);
    assert.equal(last.by, a.id);

    assert.deepEqual(got("sent"), { sent: true });
    assert.deepEqual(got("self"), { sent: false, error: `Conversation ${a.id} is you. A message goes to another conversation.` });
    assert.deepEqual(got("whoami"), {
      you: a.id,
      // Open ones first, the most recently updated first: ws-1 got a log entry after ws-2 was opened.
      workstreams: [
        { id: "ws-1", title: "Bulk invoice export", status: "open", part: "Implements it." },
        { id: "ws-2", title: "Invoice export in bulk", status: "open", part: "Checks it." },
      ],
    });

    // A fork learns that it is a copy, and of whom.
    const fork = await t.fork(a);
    const copy = (await run(fork, [`show("whoami", await tools.hivemind_whoami({}));`]))("whoami");
    assert.equal(copy.you, fork.id);
    assert.equal(copy.copyOf, a.id);
    assert.deepEqual(copy.workstreams, []);
    assert.equal(copy.copyOfWorkstreams.length, 2);

    const system = t.systems[0]!;
    for (const name of ["hivemind_list", "hivemind_read", "hivemind_open", "hivemind_update", "hivemind_message", "hivemind_whoami"]) {
      assert.ok(system.includes(name), `${name} is declared for scripts`);
    }
    assert.ok(system.includes("logTotal") && system.includes("copyOfWorkstreams"), "with the types of their objects");
    assert.match(await t.call(a, "hivemind_list", {}), /hivemind_list/, "the model cannot call a tool directly; it is told the tool is not available");
  } finally {
    await t.close();
  }
});
