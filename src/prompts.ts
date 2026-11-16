import { readFileSync } from "node:fs";

/** The prompt section: the environment the conversations live in and how to work in it. Kept as a file of its own because it is the main part of the extension. */
export const PROMPT = readFileSync(new URL("../PROMPT.md", import.meta.url), "utf8").trim();

export const TOOL_DESCRIPTIONS = {
  list:
    "List the workstreams on the blackboard, most recently updated first: id, title, state, the conversations involved, and the start of the description. Without arguments it shows the open ones. `query` searches the titles, descriptions and closing summaries of all workstreams, done ones included, and returns the best matches first. `status` narrows to \"open\" or \"done\", or widens to \"all\". `conversation` keeps the workstreams one conversation is involved in. The answer starts with your own conversation id.",
  read:
    "Read one workstream in full: its description, its closing summary when it is done, every conversation involved with its own account of its part, and the newest entries of its log. Pass `before` with an entry number to see older log entries.",
  open:
    "Open a new workstream on the blackboard and record this conversation as involved in it. Look at the blackboard first: a workstream may already exist for this work. `title` is short and stable. `description` is the current state: the goal, where it stands, and what is next or blocking. `involvement` says what this conversation's part is and what it is responsible for, and who it works with and where.",
  update:
    "Change a workstream. Pass only what changes. `log` adds one entry about something that happened to the work: progress, a decision, a block, new information. `description` replaces the description; rewrite it whenever it no longer says how things stand. `involvement` sets or rewrites this conversation's own part, and is required the first time this conversation changes a workstream. `status` \"done\" closes it and needs `summary`: what happened and how it ended, complete enough that a later reader needs nothing else. `status` \"open\" reopens a done workstream.",
  message:
    "Send a message to another conversation of this agent, by its id as the blackboard shows it. A conversation that is working receives it in the middle of its work; an idle one is woken by it, however old it is. The call returns at once: an answer, if any, arrives later as a message to this conversation. `reply` says whether you expect an answer. `workstream` names the workstream the message is about, when there is one. Write so that it stands alone: the receiver does not see your context. When you pass on what a person said or asked, name the person.",
} as const;
