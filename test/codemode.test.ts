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
      `show("missing", await tools.hivemind_read_workstream({ workstream: "ws-4" }));`,
      `show("opened", await tools.hivemind_open_workstream({ title: "Bulk invoice export", description: "CSV export for finance.", involvement: "Implements it." }));`,
      `show("twin", await tools.hivemind_open_workstream({ title: "Invoice export in bulk", description: "Same?", involvement: "Checks it." }));`,
      `show("wrote", await tools.hivemind_write_log({ text: "Schema agreed with finance.", workstream: "ws-1" }));`,
      `show("plain", await tools.hivemind_write_log({ text: "Told Luis that the test database is refreshed every night." }));`,
      `show("long", await tools.hivemind_write_log({ text: "${"x".repeat(241)}" }));`,
      `show("longish", await tools.hivemind_write_log({ text: "${"x".repeat(210)}" }));`,
      `show("updated", await tools.hivemind_update_workstream({ workstream: "ws-1", description: "Schema agreed. Backend next." }));`,
      `show("noop", await tools.hivemind_update_workstream({ workstream: "ws-1" }));`,
      `show("log", await tools.hivemind_read_log({}));`,
      `show("found", await tools.hivemind_read_log({ query: "schema payroll", limit: 1 }));`,
      `show("list", await tools.hivemind_list_workstreams({}));`,
      `show("read", await tools.hivemind_read_workstream({ workstream: "ws-1" }));`,
      `show("closed", await tools.hivemind_update_workstream({ workstream: "ws-2", status: "done", outcome: "Same work as ws-1; continuing there." }));`,
      `show("sent", await tools.hivemind_send_message({ to: ${b.id}, text: "Heads up: I am on the invoice export.", reply: false, workstream: "ws-1" }));`,
      `show("self", await tools.hivemind_send_message({ to: ${a.id}, text: "hello", reply: false }));`,
      `show("whoami", await tools.hivemind_whoami({}));`,
    ]);

    assert.deepEqual(got("missing"), { you: a.id, error: "There is no workstream ws-4. Call hivemind_list_workstreams to see the open ones." }, "a refusal comes back as the object, and the script goes on");
    assert.deepEqual(got("opened"), { id: "ws-1", similar: [] });
    assert.deepEqual(got("twin"), { id: "ws-2", similar: [{ id: "ws-1", title: "Bulk invoice export" }] });
    assert.deepEqual(got("wrote"), { n: 3 });
    assert.deepEqual(got("plain"), { n: 4 });
    assert.deepEqual(got("long"), { error: "The entry is too long: `text` has 241 characters, and the most is 200. An entry holds one fact: shorten it, or split it into two entries, and write it again. Nothing was written to the log." }, "a refused entry does not end the script: it comes back as an error to inspect");
    assert.deepEqual(got("longish"), { n: 5, warning: "The entry has 210 characters. The most is 200: write shorter entries." });
    assert.deepEqual(got("updated"), { changed: ["rewrote the description"] });
    assert.deepEqual(got("noop"), { changed: [], error: "Pass at least one of `description`, `involvement` or `status`." });

    const log = got("log");
    assert.deepEqual([log.you, log.total, log.older], [a.id, 5, undefined]);
    assert.deepEqual(log.entries.map((entry: { n: number }) => entry.n), [1, 2, 3, 4, 5]);
    assert.deepEqual(Object.keys(log.entries[2]).sort(), ["at", "by", "n", "text", "workstream"]);
    assert.deepEqual([log.entries[2].workstream, log.entries[2].by, log.entries[2].text], ["ws-1", a.id, "Schema agreed with finance."]);
    assert.match(log.entries[2].at, /^\d{4}-\d\d-\d\dT/);
    assert.equal(log.entries[3].workstream, undefined, "an entry about no workstream has no workstream");
    const found = got("found");
    assert.deepEqual(found.entries.map((entry: { n: number }) => entry.n), [3]);
    assert.equal(found.matchedWords, 1);

    const list = got("list");
    assert.equal(list.you, a.id);
    assert.equal(list.total, 2);
    assert.deepEqual(Object.keys(list.workstreams[0]).sort(), ["description", "id", "involved", "title", "updatedAt"]);
    assert.deepEqual(list.workstreams.map((w: { id: string }) => w.id), ["ws-1", "ws-2"], "the one changed last is first");
    assert.deepEqual([list.workstreams[0].involved, list.workstreams[0].description], [[a.id], "Schema agreed. Backend next."]);
    assert.match(list.workstreams[0].updatedAt, /^\d{4}-\d\d-\d\dT/);

    const read = got("read");
    assert.equal(read.you, a.id);
    assert.equal(read.workstream.title, "Bulk invoice export");
    assert.deepEqual(read.workstream.involved.map((i: { conversation: number; part: string }) => [i.conversation, i.part]), [[a.id, "Implements it."]]);
    assert.deepEqual(read.workstream.entries.map((entry: { n: number; text: string }) => [entry.n, entry.text]), [[1, "Opened ws-1: Bulk invoice export"], [3, "Schema agreed with finance."]]);
    assert.equal(read.workstream.entries[1].by, a.id);
    assert.equal(read.workstream.older, undefined);

    assert.deepEqual(got("closed"), { changed: ["marked it done and wrote its outcome to the log"] });
    assert.deepEqual(got("sent"), { sent: true });
    assert.deepEqual(got("self"), { sent: false, error: `Conversation ${a.id} is you. A message goes to another conversation.` });
    assert.deepEqual(got("whoami"), {
      you: a.id,
      // Only the open one: ws-2 was marked done.
      workstreams: [{ id: "ws-1", title: "Bulk invoice export", part: "Implements it." }],
    });

    // A fork learns that it is a copy, and of whom.
    const fork = await t.fork(a);
    const copy = (await run(fork, [`show("whoami", await tools.hivemind_whoami({}));`]))("whoami");
    assert.equal(copy.you, fork.id);
    assert.equal(copy.copyOf, a.id);
    assert.deepEqual(copy.workstreams, []);
    assert.equal(copy.copyOfWorkstreams.length, 1);

    const system = t.systems[0]!;
    const names = ["hivemind_write_log", "hivemind_read_log", "hivemind_list_workstreams", "hivemind_read_workstream", "hivemind_open_workstream", "hivemind_update_workstream", "hivemind_send_message", "hivemind_whoami"];
    for (const name of names) assert.ok(system.includes(name), `${name} is declared for scripts`);
    assert.ok(system.includes("matchedWords") && system.includes("copyOfWorkstreams"), "with the types of their objects");
    const told = system.replace(/\\+"/g, '"');
    for (const name of names.filter((tool) => tool !== "hivemind_whoami")) {
      const section = told.slice(told.indexOf(`### \`${name}\``), told.indexOf("codemode tool declaration", told.indexOf(`### \`${name}\``)));
      assert.match(section, /Check `error` in the result/, `${name} tells its caller to check the error`);
    }
    assert.match(await t.call(a, "hivemind_read_log", {}), /hivemind_read_log/, "the model cannot call a tool directly; it is told the tool is not available");
  } finally {
    await t.close();
  }
});
