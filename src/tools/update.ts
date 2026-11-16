import { defineTool } from "@earendil-works/pi-durable";
import { isInvolved, reindex, workstreamForUpdate, type Workstream } from "../board.ts";
import { LIMITS } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { UPDATE_OUTPUT } from "./schemas.ts";
import { failure, firstReason, parameters, result, tooLong, toText, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const UPDATE_TOOL = "hivemind_update";

type Change = { description?: string; log?: string; involvement?: string; status?: "open" | "done"; summary?: string };

/** Apply the change. Returns what was done, one phrase per part, or why nothing was. */
function apply(workstream: Workstream, change: Change, self: number, at: number, copiedFrom?: number): { done: string[] } | { refused: string } {
  const closing = change.status === "done" && workstream.status === "open";
  const reopening = change.status === "open" && workstream.status === "done";
  const doneAfter = change.status === undefined ? workstream.status === "done" : change.status === "done";

  if (!isInvolved(workstream, self) && change.involvement === undefined) {
    // A fork remembers what its parent did, so it may take the parent's part for its own.
    const copy =
      copiedFrom !== undefined && isInvolved(workstream, copiedFrom)
        ? ` You may remember being part of it: that was conversation ${copiedFrom}, which this conversation started as a copy of. You are conversation ${self}.`
        : "";
    return { refused: `You are not yet involved in ${ref(workstream.id)}.${copy} Pass \`involvement\` in the same call: what your part in it is and what you are responsible for.` };
  }
  if (closing && change.summary === undefined) {
    return { refused: `Marking ${ref(workstream.id)} done needs \`summary\`: what happened and how it ended.` };
  }
  if (change.summary !== undefined && !doneAfter) {
    return { refused: "`summary` is the closing summary of a done workstream. To record progress on an open one, use `log` and `description`." };
  }

  const done: string[] = [];
  if (change.involvement !== undefined) {
    const existing = workstream.involved[String(self)];
    if (existing === undefined) {
      workstream.involved[String(self)] = { conversation: self, text: change.involvement, since: at, updatedAt: at };
      done.push("recorded you as involved");
    } else {
      existing.text = change.involvement;
      existing.updatedAt = at;
      done.push("rewrote your involvement");
    }
  }
  if (change.description !== undefined) {
    workstream.description = change.description;
    done.push("rewrote the description");
  }
  if (change.log !== undefined) {
    workstream.log.push({ at, by: self, text: change.log });
    done.push(`added log entry ${workstream.log.length}`);
  }
  if (reopening) {
    // The closing summary describes an end that no longer holds. It moves into the log, so nothing is lost.
    workstream.log.push({ at, by: self, text: workstream.summary === undefined ? "Reopened." : `Reopened. The closing summary was: ${workstream.summary}` });
    workstream.status = "open";
    delete workstream.summary;
    delete workstream.closedAt;
    done.push("reopened it");
  }
  if (change.summary !== undefined) {
    workstream.summary = change.summary;
    if (!closing) done.push("rewrote the closing summary");
  }
  if (closing) {
    workstream.status = "done";
    workstream.closedAt = at;
    workstream.log.push({ at, by: self, text: "Marked done." });
    done.push("marked it done");
  }
  if (done.length === 0) return { refused: `Nothing would change: ${ref(workstream.id)} is already ${workstream.status}. Pass \`log\`, \`description\`, \`involvement\`, \`status\` or \`summary\`.` };
  workstream.updatedAt = at;
  return { done };
}

export function updateTool() {
  return defineTool({
    name: UPDATE_TOOL,
    description: TOOL_DESCRIPTIONS.update,
    parameters: parameters(
      {
        workstream: WORKSTREAM_PARAMETER,
        log: { type: "string", description: "One entry about something that happened to the work." },
        description: { type: "string", description: "The new description: the current state, replacing the old text." },
        involvement: { type: "string", description: "This conversation's own part: what it is responsible for, who it works with and where." },
        status: { type: "string", enum: ["open", "done"], description: '"done" closes the workstream and needs `summary`; "open" reopens it.' },
        summary: { type: "string", description: "Closing summary: what happened and how it ended." },
      },
      ["log", "description", "involvement", "status", "summary"],
    ),
    structuredOutputSchema: UPDATE_OUTPUT,
    executionMode: "sequential",
    execute: async (args, api, context) => {
      const refuse = (error: string) => failure(error, { changed: [] });
      const input = args as Record<string, unknown>;
      const self = api.conversationId as number;
      const id = toWorkstreamId(input.workstream);
      if (Number.isNaN(id)) return refuse('`workstream` must be a workstream id such as "ws-12".');
      if (input.status !== undefined && input.status !== null && input.status !== "open" && input.status !== "done") {
        return refuse('`status` must be "open" or "done".');
      }
      const change: Change = {};
      const description = toText(input.description);
      const log = toText(input.log);
      const involvement = toText(input.involvement);
      const summary = toText(input.summary);
      if (description !== undefined) change.description = description;
      if (log !== undefined) change.log = log;
      if (involvement !== undefined) change.involvement = involvement;
      if (summary !== undefined) change.summary = summary;
      if (input.status === "open" || input.status === "done") change.status = input.status;
      if (Object.keys(change).length === 0) return refuse("Pass at least one of `log`, `description`, `involvement`, `status` or `summary`.");
      const reason = firstReason(
        tooLong("description", description, LIMITS.description),
        tooLong("log", log, LIMITS.log),
        tooLong("involvement", involvement, LIMITS.involvement),
        tooLong("summary", summary, LIMITS.summary),
      );
      if (reason !== undefined) return refuse(reason);

      return api.commit(async (tx) => {
        const workstream = await workstreamForUpdate(tx, id);
        if (workstream === undefined) return refuse(`There is no workstream ${ref(id)}. Call hivemind_list to see the ones that exist.`);
        const copiedFrom = (await tx.conversation(api.conversationId))?.parent?.conversationId as number | undefined;
        const applied = apply(workstream, change, self, api.now(), copiedFrom);
        if ("refused" in applied) return refuse(applied.refused);
        await reindex(tx, workstream);
        const list = applied.done.length === 1 ? applied.done[0]! : `${applied.done.slice(0, -1).join(", ")} and ${applied.done[applied.done.length - 1]}`;
        return result(`${ref(id)} · ${workstream.title}: ${list}.`, { changed: applied.done });
      }, context);
    },
  });
}
