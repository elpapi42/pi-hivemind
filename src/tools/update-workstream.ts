import { defineTool } from "@earendil-works/pi-durable";
import { appendEntry, isInvolved, reindex, workstreamForUpdate, type Workstream } from "../board.ts";
import { ENTRY_SLACK, LIMITS, type HivemindConfig } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { ref } from "../render.ts";
import { UPDATE_WORKSTREAM_OUTPUT } from "./schemas.ts";
import { failure, firstReason, parameters, result, tooLong, toText, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const UPDATE_WORKSTREAM_TOOL = "hivemind_update_workstream";

type Change = { description?: string; involvement?: string; status?: "open" | "done"; outcome?: string };

/** Apply the change. Returns what was done, one phrase per part, with the log entry the change deserves, or why nothing was done. */
function apply(workstream: Workstream, change: Change, self: number, at: number, copiedFrom?: number): { done: string[]; entry?: string } | { refused: string } {
  const closing = change.status === "done" && workstream.status === "open";
  const reopening = change.status === "open" && workstream.status === "done";

  if (!isInvolved(workstream, self) && change.involvement === undefined) {
    // A fork remembers what its parent did, so it may take the parent's part for its own.
    const copy =
      copiedFrom !== undefined && isInvolved(workstream, copiedFrom)
        ? ` You may remember being part of it: that was conversation ${copiedFrom}, which this conversation started as a copy of. You are conversation ${self}.`
        : "";
    return {
      refused: `You are not yet involved in ${ref(workstream.id)}.${copy} Pass \`involvement\` in the same call: what your part in it is and what you are responsible for. To only record something about it, write a log entry with hivemind_write_log instead.`,
    };
  }
  if (closing && change.outcome === undefined) {
    return { refused: `Marking ${ref(workstream.id)} done needs \`outcome\`: one fact that says how the work ended. It is written to the log as the closing entry.` };
  }
  if (change.outcome !== undefined && !closing) {
    return {
      refused:
        workstream.status === "done"
          ? `${ref(workstream.id)} is already done. To add something about it, write a log entry with hivemind_write_log and its id.`
          : '`outcome` goes with `status` "done": it says how the work ended. To record progress on an open workstream, write a log entry with hivemind_write_log and rewrite `description`.',
    };
  }

  const done: string[] = [];
  let entry: string | undefined;
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
  if (reopening) {
    workstream.status = "open";
    delete workstream.closedAt;
    entry = `Reopened ${ref(workstream.id)}: ${workstream.title}`;
    done.push("reopened it");
  }
  if (closing) {
    // The end of a workstream is part of its history, so it is an entry of the log and not a field of the document.
    workstream.status = "done";
    workstream.closedAt = at;
    entry = `Closed ${ref(workstream.id)}: ${change.outcome}`;
    done.push("marked it done and wrote its outcome to the log");
  }
  if (done.length === 0) return { refused: `Nothing would change: ${ref(workstream.id)} is already ${workstream.status}. Pass \`description\`, \`involvement\` or \`status\`.` };
  workstream.updatedAt = at;
  return { done, ...(entry === undefined ? {} : { entry }) };
}

export function updateWorkstreamTool(config: HivemindConfig) {
  return defineTool({
    name: UPDATE_WORKSTREAM_TOOL,
    description: TOOL_DESCRIPTIONS.updateWorkstream,
    parameters: parameters(
      {
        workstream: WORKSTREAM_PARAMETER,
        description: { type: "string", description: "The new description: the current state, replacing the old text." },
        involvement: { type: "string", description: "This conversation's own part: what it is responsible for, who it works with and where." },
        status: { type: "string", enum: ["open", "done"], description: '"done" closes the workstream and needs `outcome`; "open" reopens it.' },
        outcome: { type: "string", description: "How the work ended: one fact in at most 200 characters. Written to the log as the closing entry." },
      },
      ["description", "involvement", "status", "outcome"],
    ),
    structuredOutputSchema: UPDATE_WORKSTREAM_OUTPUT,
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
      const involvement = toText(input.involvement);
      const outcome = toText(input.outcome)?.replace(/\s+/g, " ");
      if (description !== undefined) change.description = description;
      if (involvement !== undefined) change.involvement = involvement;
      if (outcome !== undefined) change.outcome = outcome;
      if (input.status === "open" || input.status === "done") change.status = input.status;
      if (Object.keys(change).length === 0) return refuse("Pass at least one of `description`, `involvement` or `status`.");
      const reason = firstReason(
        tooLong("description", description, LIMITS.description),
        tooLong("involvement", involvement, LIMITS.involvement),
      );
      if (reason !== undefined) return refuse(reason);
      // The outcome becomes a log entry, so it has the ceiling of one, and the same room for a miscount.
      if (outcome !== undefined && outcome.length > LIMITS.entry + ENTRY_SLACK) {
        return refuse(`The outcome is too long: \`outcome\` has ${outcome.length} characters, and the most is ${LIMITS.entry}. It is one fact that says how the work ended: shorten it, and put the rest in \`description\`. Nothing changed.`);
      }
      const warning = outcome !== undefined && outcome.length > LIMITS.entry ? `The outcome has ${outcome.length} characters. The most is ${LIMITS.entry}: write shorter ones.` : undefined;

      return api.commit(async (tx) => {
        const workstream = await workstreamForUpdate(tx, id);
        if (workstream === undefined) return refuse(`There is no workstream ${ref(id)}. Call hivemind_list_workstreams to see the open ones.`);
        const copiedFrom = (await tx.conversation(api.conversationId))?.parent?.conversationId as number | undefined;
        const at = api.now();
        const applied = apply(workstream, change, self, at, copiedFrom);
        if ("refused" in applied) return refuse(applied.refused);
        await reindex(tx, workstream);
        if (applied.entry !== undefined) await appendEntry(tx, config, { by: self, at, text: applied.entry, workstream });
        const list = applied.done.length === 1 ? applied.done[0]! : `${applied.done.slice(0, -1).join(", ")} and ${applied.done[applied.done.length - 1]}`;
        return result(`${ref(id)} · ${workstream.title}: ${list}.${warning === undefined ? "" : ` ${warning}`}`, { changed: applied.done, ...(warning === undefined ? {} : { warning }) });
      }, context);
    },
  });
}
