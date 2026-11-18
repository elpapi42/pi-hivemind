import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, defineDoc, defineDocFamily, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { IndexDoc, WorkstreamDoc } from "../src/index.ts";
import { ctx } from "./helpers.ts";

/** The two documents as the first version of Hivemind defined them. */
const OldIndex = defineDoc<{ next: number; rows: Record<string, { id: number; title: string; status: string; description: string; summary?: string; updatedAt: number; involved: number[] }> }>({
  kind: "hivemind.index",
  version: 1,
  scope: "session",
  initial: () => ({ next: 1, rows: {} }),
  checkpointWhen: () => false,
});
const OldWorkstream = defineDocFamily<{ id: number; title: string; description: string; status: string; openedAt: number; openedBy: number; updatedAt: number; involved: Record<string, { conversation: number; text: string; since: number; updatedAt: number }>; log: { at: number; by: number; text: string }[] }, null>({
  kind: "hivemind.workstream",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ id: 1, title: "Bulk invoice export", description: "CSV export for finance.", status: "open", openedAt: 1, openedBy: 7, updatedAt: 2, involved: { "7": { conversation: 7, text: "Implements it.", since: 1, updatedAt: 1 } }, log: [{ at: 1, by: 7, text: "Opened." }] }),
  checkpointWhen: () => false,
});

test("documents of the first version are read as the new ones: the index keeps the open rows, a workstream drops its own log", async () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-hivemind-"));
  const open = async () => {
    const models = createModels();
    models.setProvider(fauxProvider().provider);
    return Harness.open(await openNodeSqliteStorage(join(folder, "session.sqlite")), { models, registry: createRegistry() }, ctx);
  };
  let harness = await open();
  await (await harness.root(ctx)).commit(async (tx) => {
    const index = await tx.doc(OldIndex);
    index.next = 3;
    index.rows["1"] = { id: 1, title: "Bulk invoice export", status: "open", description: "CSV export for finance.", updatedAt: 2, involved: [7] };
    index.rows["2"] = { id: 2, title: "Login page redesign", status: "done", description: "New layout.", summary: "Shipped.", updatedAt: 3, involved: [8] };
    await tx.doc(OldWorkstream, "1", null);
  }, ctx);
  await harness.close(ctx);

  harness = await open();
  try {
    assert.deepEqual(await harness.snapshot(IndexDoc, ctx), {
      pageSize: 0,
      piecePages: 0,
      lastPage: -1,
      nextWorkstream: 3,
      open: { "1": { id: 1, title: "Bulk invoice export", updatedAt: 2, involved: [7] } },
    });
    const workstream = (await harness.snapshot(WorkstreamDoc, "1", ctx))!;
    assert.deepEqual(workstream.pages, []);
    assert.equal("log" in workstream, false);
    assert.equal(workstream.involved["7"]!.text, "Implements it.");
  } finally {
    await harness.close(ctx);
    rmSync(folder, { recursive: true, force: true });
  }
});
