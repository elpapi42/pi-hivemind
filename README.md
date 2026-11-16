# Hivemind

Hivemind makes the conversations of one [Pi Durable](https://github.com/earendil-works/pi) agent work as a collective and present as one individual.

This repository is the Pi Durable extension, `pi-hivemind`. It is experimental: it has been tested with a fake provider only, not yet with a real model.

## The idea

An agent that many people reach from many places runs as many conversations: one per chat channel, per ticket, per review. Each has its own memory, and none knows what the others do. To the people who talk to it, the agent then feels like several strangers who share a name. It asks again what it was already told, it does the same work twice, and it cannot say what it is doing elsewhere.

Hivemind gives the conversations two things, and a way of working with them:

- **A blackboard.** Every conversation registers the work it has open, keeps it current, and reads what the others registered.
- **Direct messages.** Any conversation can send a message to another: to ask for a report, to change the course of its work, or to pass on what a person said.
- **An operating mindset.** A prompt section explains the environment the conversations live in. Inside, they are a collective that keeps itself aligned. Outside, they are one individual that says "I" about all of its work.

The extension names no chat, ticket or code hosting service. It knows only conversations, workstreams and messages, so it works in any harness.

## The blackboard

The blackboard holds every workstream of the harness, open and done. A workstream is a piece of work with an outcome that takes more than one reply.

| Part | What it is |
| --- | --- |
| Title | Short and stable |
| Description | The current state: the goal, where it stands, what is next or blocking. It is rewritten when the state changes. |
| Log | What happened to the work over time, each entry with its time and the conversation that wrote it. Entries are only added. |
| Involved | Each conversation that has a part in the work, by id, with its own account of that part. The parts differ in weight: one conversation may plan and build a feature, another may have answered one question about it. |
| Status | Open or done. Marking a workstream done needs a closing summary. |

This is how a conversation reads one:

```
ws-12 · Bulk invoice export · open
Opened 2026-11-12 09:00 UTC by conversation 31 · updated 2026-11-14 16:40 UTC

Description:
CSV export for finance. Backend merged; the screen is in review.
Blocked on the column list from finance.

Involved:
- conversation 31, since 2026-11-12 09:00: Plans and implements the feature.
- conversation 58, since 2026-11-14 16:02: Answered a status question from a person in finance and relayed a requirement.

Log (entries 1 to 4 of 4):
1. 2026-11-12 09:00 · conversation 31 · Opened.
2. 2026-11-13 11:20 · conversation 31 · Backend merged.
3. 2026-11-14 16:02 · conversation 58 · Finance also needs the tax id on every row. Told conversation 31.
4. 2026-11-14 16:40 · conversation 31 · Added the tax id to the plan. Waiting for the full column list.
```

A done workstream stays on the blackboard. It is the record of what the agent did, and its conversations can still be asked about it.

### Storage

Pi Durable can read a document only by its exact address; it cannot list or search documents. So the blackboard is two kinds of harness-wide document:

| Document | Key | Holds |
| --- | --- | --- |
| `hivemind.workstream` | The workstream id | The whole workstream |
| `hivemind.index` | Single document | One row per workstream: id, title, status, description, closing summary, time of the last change, and the ids of the conversations involved |

Every change to a workstream updates its index row in the same commit, so the two cannot differ. Lists and searches read only the index. The search ranks rows by the words of the query found in the title, the description and the closing summary. It uses no embeddings and no outside service.

## Messages

`hivemind_message` sends a text to one conversation by its id. A conversation that is working receives it after its current tool round, and goes on with it in view. An idle conversation is woken by it and starts a run, however old the conversation is. The call returns at once. An answer comes back the same way, as a message that the first conversation receives or is woken by.

A message arrives as a user message in this form:

```
<hivemind-message from="31" workstream="ws-12" reply="expected">
Where does the export stand? A person in finance asks whether it ships this week.
</hivemind-message>
```

The extension never decides who gets a message. The sender reads on the blackboard who is involved and how, and chooses.

## Tools

| Tool | What it does | What a script gets |
| --- | --- | --- |
| `hivemind_list` | Lists the open workstreams. `query` searches all of them, done ones included; `status` and `conversation` filter. | `{ you, total, workstreams: [{ id, title, status, updatedAt, involved, description, summary? }] }` |
| `hivemind_read` | Shows one workstream in full, with the newest page of its log; `before` reads further back. | `{ you, workstream?: { id, title, status, updatedAt, description, summary?, involved: [{ conversation, part, since }], log: [{ n, at, by, text }], logTotal } }` |
| `hivemind_open` | Opens a workstream and records the caller as involved. It names open workstreams with similar titles, so a duplicate is noticed at once. | `{ id, similar: [{ id, title }] }` |
| `hivemind_update` | Adds a log entry, rewrites the description, sets the caller's involvement, marks the workstream done with a closing summary, or reopens it | `{ changed: string[] }` |
| `hivemind_message` | Sends a message to another conversation | `{ sent }` |
| `hivemind_whoami` | Tells the caller its own conversation id and the workstreams it is involved in | `{ you, workstreams: [{ id, title, status, part }], copyOf?, copyOfWorkstreams? }` |

Every tool declares its object as structured output, so codemode scripts receive it and the codemode section shows its type; a model that calls a tool directly reads text. Times are ISO strings. Each tool checks what it is asked and refuses with an explanation: in the object, `error` says why, and the script goes on. A conversation that changes a workstream for the first time must say what its part is. Asking for a workstream that does not exist creates nothing.

### A conversation's own id

A conversation should not keep its id in mind. A fork starts with the context of its parent, so an id it read there is the parent's, not its own. Hivemind therefore handles identity in three ways:

- **The tools act as the caller.** A new workstream, a log entry, an involvement and a message all carry the id of the conversation that really made the call.
- **Answers mark the caller:** the text marks it as "(you)" among the conversations involved, and the objects carry its id as `you`.
- **`hivemind_whoami` gives the id on request,** with the workstreams the caller is involved in. For a fork it also names the parent and says that the work from before the fork is recorded under the parent.

A fork that changes a workstream its parent is involved in is told so, and asked for its own involvement.

The prompt section does not give the id either: a fork must be sent the same system prompt as its parent to read the parent's provider cache, so the section is the same text for every conversation.

## What the conversations are told

The prompt section is [`PROMPT.md`](PROMPT.md). It is the main part of the extension, because the tools do nothing by themselves: nothing runs in the background and nothing reminds a conversation. The section explains:

- **The environment.** The conversation is one of several that make up one agent, and others may be working right now.
- **When to use the blackboard.** The duties are tied to moments: a request arrives, before starting work, the state changes, the work ends.
- **How messages work,** how to tell one from a person's input, and when not to answer.
- **One individual outside.** The agent says "I" about all of its work, owns what any conversation promised, never sends a person to another conversation, and says "let me check" instead of inventing an answer.

## Install

### With Headless Pi

1. Put this folder in `<workspace>/.hpi/extensions/pi-hivemind`.
2. Add `"pi-hivemind"` to `defaultExtensions` in `<workspace>/.hpi/config.json`.
3. Restart the daemon.

The blackboard only helps when every conversation of the harness uses it, so enable it for all of them.

### With Pi Durable directly

```ts
import { createHivemindExtension } from "./src/index.ts";

registry.install(createHivemindExtension({ codemodeOnly: true }));
```

## Settings

With Headless Pi, settings are read from `<workspace>/.hpi/pi-hivemind.json`. Every field is optional.

| Setting | Default | What it does |
| --- | --- | --- |
| `codemodeOnly` | false | Offer the tools only to codemode scripts, not to the model directly. Needs the codemode extension. In a script a refusal is returned as text, so the script goes on. |
| `listLimit` | 30 | Most workstreams one list answer shows |
| `logPage` | 20 | Most log entries one read answer shows |

Texts have generous ceilings in characters (title 120, description 4000, involvement 600, log entry 1500, closing summary 3000, message 12000). They stop mistakes, such as a file pasted into a title.

## Limits of this version

- **It rests on the prompt.** No hook checks that a conversation registered its work, and no workstream closes by itself. A blackboard that conversations neglect is wrong, and others will act on it.
- **Nothing stops two conversations from answering each other forever.** Each message says whether a reply is expected, and the prompt says not to answer only to acknowledge.
- **A woken conversation pays for its whole context.** Its provider cache has usually expired. A good closing summary makes waking an old conversation rare.
- **A message is stored as an ordinary user message.** A program that shows the transcript shows it like a person's input, with the `<hivemind-message>` tag.
- **The search does not read logs.** A detail that is only in a log entry is found by reading the workstream, not by searching.
- **The index is one document,** read whole for every list and search. That is fine for thousands of workstreams, not for millions.
- **Conversations a task owns,** such as a subagent's, cannot be sent messages.
- Tested with Pi Durable 1.5.2.

## Development

```sh
npm install
npm test          # tests with a fake provider
npm run typecheck
```

The code is TypeScript that Node runs directly, with no build step.

| File | What it holds |
| --- | --- |
| `PROMPT.md` | The prompt section |
| `src/index.ts` | The extension and its default export |
| `src/config.ts` | Settings, defaults and text ceilings |
| `src/board.ts` | The workstream and index documents, and the changes that keep them together |
| `src/search.ts` | Ranking index rows against a query |
| `src/render.ts` | Workstreams, lists and messages as the model reads them |
| `src/prompts.ts` | The tool descriptions, and loading the prompt section |
| `src/tools/` | The six tools |
