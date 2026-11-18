# Hivemind

Hivemind makes the conversations of one [Pi Durable](https://github.com/earendil-works/pi) agent work as a collective and present as one individual.

This repository is the Pi Durable extension, `pi-hivemind`. It is experimental.

## The idea

An agent that many people reach from many places runs as many conversations: one per chat channel, per ticket, per review. Each has its own memory, and none knows what the others do. To the people who talk to it, the agent then feels like several strangers who share a name. It asks again what it was already told, it does the same work twice, and it cannot say what it is doing elsewhere.

Hivemind gives the conversations three things, and a way of working with them:

- **A log.** Every conversation writes what it does to one shared log, while it does it: a request that arrived, a decision, a promise, something it changed. Reading the log is the cheap way to know the state of the hive.
- **Workstreams.** Work that needs more than log entries gets a workstream: a description of its current state and the conversations that have a part in it. Its history is the log entries that name it.
- **Direct messages.** Any conversation can send a message to another: to ask for a report, to change the course of its work, or to pass on what a person said.
- **An operating mindset.** A prompt section explains the environment the conversations live in. Inside, they are a collective that keeps itself aligned. Outside, they are one individual that says "I" about all of its work.

The extension names no chat, ticket or code hosting service. It knows only conversations, log entries, workstreams and messages, so it works in any harness.

## The log

An entry is one fact in at most 200 characters, about 50 tokens. A model cannot count characters exactly, so the tool keeps an entry that is up to 40 characters over and tells its writer; a longer one is refused. It has the time, the conversation that wrote it, and the workstream it is about when there is one. Its number is its place in the log.

This is how a conversation reads the log:

```
3 entries, oldest first. The log has 4812.

4810 · 2026-11-17 16:02 · conversation 58 · ws-12 · Ana from finance asks in the billing channel when the invoice export ships. I am checking.
4811 · 2026-11-17 16:03 · conversation 31 · ws-12 · Added the tax id column to the plan. Waiting for the full column list.
4812 · 2026-11-17 16:05 · conversation 77 (you) · Told Luis in a direct message that the test database is refreshed every night.
```

A read gives the newest 100 entries, or those of one conversation, one workstream or a period, or those that have the words of a query. An entry is short on purpose: a full read of 100 is about 6,500 tokens at most.

## Workstreams

A workstream is a piece of work with an outcome that needs more than log entries can hold.

| Part | What it is |
| --- | --- |
| Title | Short and stable |
| Description | The current state: the goal, where it stands, what is next or blocking. It is rewritten when the state changes. |
| Involved | Each conversation that has a part in the work, by id, with its own account of that part |
| Status | Open or done. Marking a workstream done needs a closing summary. |
| Entries | The log entries that name it. Any conversation can write one, also one that has no part in the work. |

This is how a conversation reads one:

```
ws-12 · Bulk invoice export · open
Opened 2026-11-12 09:00 UTC by conversation 31 · changed 2026-11-14 16:40 UTC

Description:
CSV export for finance. Backend merged; the screen is in review.
Blocked on the column list from finance.

Involved:
- conversation 31, since 2026-11-12 09:00: Plans and implements the feature.

Log entries, oldest first:
1204 · 2026-11-12 09:00 · conversation 31 · Opened ws-12: Bulk invoice export
1377 · 2026-11-13 11:20 · conversation 31 · Backend of the invoice export merged.
4810 · 2026-11-17 16:02 · conversation 58 · Ana from finance asks in the billing channel when the invoice export ships. I am checking.
4811 · 2026-11-17 16:03 · conversation 31 · Added the tax id column to the plan. Waiting for the full column list.
```

A conversation changes a workstream (its description, its status) only after it has recorded its own part in it. The extension writes the entries that say a workstream was opened, closed or reopened.

A done workstream is no longer listed. It is still read by its id, its conversations can still be asked about it, and the log says when and under which id it ended.

## Storage

Pi Durable reads a document only by its exact address, and always whole; it cannot list or search documents. So no document of Hivemind grows with history:

| Document | Key | Holds | Size |
| --- | --- | --- | --- |
| `hivemind.index` | Single document | The number of the newest log page, the next workstream id, and one small row for each open workstream: id, title, time of the last change, conversations involved | Follows the open work |
| `hivemind.log` | Page number | One page of the log: 200 entries | At most about 64 KB; a full page never changes |
| `hivemind.directory` | Piece number | For each of 200 log pages: the time of its first entry and the conversations that wrote on it | At most about 30 KB |
| `hivemind.workstream` | Workstream id | The whole workstream, and the numbers of the log pages that hold its entries | Follows its own texts |

How things are found:

| To find | Path |
| --- | --- |
| The newest entries | The index names the newest page |
| An entry by its number | Entry `n` is on page `floor((n - 1) / 200)` |
| The entries of a period | Pages are in time order, so a binary search over the directory finds the page of a moment |
| The entries of a conversation | The directory names the pages a conversation wrote on; the others are not read |
| The entries of a workstream | The workstream names its pages |
| Open workstreams, by title or by conversation | The index |
| A done workstream | By its id, which its entries in the log carry |
| Entries by their words | No index: pages are read newest first, at most 50 for each call, and the answer says where to read on |

An entry is written in one commit: it goes on the newest page; the directory changes when a conversation first appears on a page, the index when a page starts, and a workstream when it first appears on a page. Pi Durable runs the commits of a harness one after the other, so entries from many conversations never collide.

Measured on SQLite storage: an entry is written in about 0.13 ms, the same at any size of the log, and 50 writers at once lose nothing. The earlier design kept a row for every workstream in the index; with 1,000,000 workstreams every change to one took 250 ms and stopped every other commit meanwhile, which is why the index now holds only the open ones.

## Messages

`hivemind_send_message` sends a text to one conversation by its id. A conversation that is working receives it after its current tool round, and goes on with it in view. An idle conversation is woken by it and starts a run, however old the conversation is. The call returns at once. An answer comes back the same way, as a message that the first conversation receives or is woken by.

A message arrives as a user message in this form:

```
<hivemind-message from="31" workstream="ws-12" reply="expected">
Where does the export stand? A person in finance asks whether it ships this week.
</hivemind-message>
```

The extension never decides who gets a message. The sender reads in the log and in the workstreams who does what, and chooses.

## Tools

| Tool | What it does | What a script gets |
| --- | --- | --- |
| `hivemind_write_log` | Adds one entry to the log: `text`, and `workstream` when it is about one | `{ n, warning? }` |
| `hivemind_read_log` | Reads the log: the newest 100 entries, or those that pass `conversation`, `workstream`, `from`, `to` and `query`; `before` reads further back | `{ you, total, entries: [{ n, at, by, workstream?, text }], older?, matchedWords? }` |
| `hivemind_list_workstreams` | Lists the open workstreams. `query` looks in the titles; `conversation` filters. | `{ you, total, workstreams: [{ id, title, updatedAt, involved, description }] }` |
| `hivemind_read_workstream` | Shows one workstream in full, open or done, with the newest 20 of its entries; `before` reads further back | `{ you, workstream?: { id, title, status, updatedAt, description, summary?, involved: [{ conversation, part, since }], entries: [{ n, at, by, text }], older? } }` |
| `hivemind_open_workstream` | Opens a workstream and records the caller as involved. It names open workstreams with similar titles, so a duplicate is noticed at once. | `{ id, similar: [{ id, title }] }` |
| `hivemind_update_workstream` | Rewrites the description, sets the caller's involvement, marks the workstream done with a closing summary, or reopens it | `{ changed: string[] }` |
| `hivemind_send_message` | Sends a message to another conversation | `{ sent }` |
| `hivemind_whoami` | Tells the caller its own conversation id and the open workstreams it is involved in | `{ you, workstreams: [{ id, title, part }], copyOf?, copyOfWorkstreams? }` |

Every tool declares its object as structured output, so codemode scripts receive it and the codemode section shows its type; a model that calls a tool directly reads text. Times are ISO strings. Each tool checks what it is asked and refuses with an explanation: in the object, `error` says why, and the script goes on. Asking for a workstream that does not exist creates nothing.

With `query`, a read of the log gives the entries that have every word, or else those that have the most, and `matchedWords` says how many. When a read stops before the start of the log, `older` is the number to pass as `before` to read on.

### A conversation's own id

A conversation should not keep its id in mind. A fork starts with the context of its parent, so an id it read there is the parent's, not its own. Hivemind therefore handles identity in three ways:

- **The tools act as the caller.** A log entry, a new workstream, an involvement and a message all carry the id of the conversation that really made the call.
- **Answers mark the caller:** the text marks it as "(you)", and the objects carry its id as `you`.
- **`hivemind_whoami` gives the id on request,** with the open workstreams the caller is involved in. For a fork it also names the parent and says that the work from before the fork is recorded under the parent.

A fork that changes a workstream its parent is involved in is told so, and asked for its own involvement.

The prompt section does not give the id either: a fork must be sent the same system prompt as its parent to read the parent's provider cache, so the section is the same text for every conversation.

## What the conversations are told

The prompt section is [`PROMPT.md`](PROMPT.md). It is the main part of the extension, because the tools do nothing by themselves: nothing runs in the background and nothing reminds a conversation. The section explains:

- **The environment.** The conversation is one of several that make up one agent, and others may be working right now.
- **The log as a way of working.** One rule: if this conversation stopped now, another must be able to answer for it and continue from the log alone. Nine moments at which to write an entry, each with an example, and four at which to read the log.
- **When work becomes a workstream,** and how to keep one current.
- **How messages work,** how to tell one from a person's input, and when not to answer.
- **One individual outside.** The agent says "I" about all of its work, owns what any conversation promised, never sends a person to another conversation, and says "let me check" instead of inventing an answer.

## Install

### With Headless Pi

1. Put this folder in `<workspace>/.hpi/extensions/pi-hivemind`.
2. Add `"pi-hivemind"` to `defaultExtensions` in `<workspace>/.hpi/config.json`.
3. Restart the daemon.

The log only helps when every conversation of the harness writes to it, so enable Hivemind for all of them.

### With Pi Durable directly

```ts
import { createHivemindExtension } from "./src/index.ts";

registry.install(createHivemindExtension({ codemodeOnly: true }));
```

With code mode, the declarations of the eight tools take about 2,900 tokens of the `codemode` section. Its default budget is 3,000 tokens for all tools without a namespace, and the tools that do not fit are left out of the section, the largest first. Raise `inlineBudget` of the codemode extension so that every tool is listed.

## Settings

With Headless Pi, settings are read from `<workspace>/.hpi/pi-hivemind.json`. Every field is optional.

| Setting | Default | What it does |
| --- | --- | --- |
| `codemodeOnly` | false | Offer the tools only to codemode scripts, not to the model directly. Needs the codemode extension. In a script a refusal is returned as text, so the script goes on. |
| `readLimit` | 100 | Entries one read of the log returns when the caller names no limit. A caller can ask for up to 500. |
| `scanPages` | 50 | Most log pages one read of the log opens |
| `listLimit` | 30 | Most workstreams one list answer shows |
| `workstreamEntries` | 20 | Entries one read of a workstream shows |
| `pageSize` | 200 | Entries on one log page. It is used only when the log is created: entry numbers depend on it, so the index keeps the value from then on. |
| `piecePages` | 200 | Log pages one directory piece covers. Also fixed when the log is created. |

Texts have ceilings in characters: log entry 200 (up to 240 is still kept, with a warning), title 120, description 4000, involvement 600, closing summary 3000, message 12000. The ceiling of an entry keeps the log cheap to read. The others stop mistakes, such as a file pasted into a title.

## Limits of this version

- **It rests on the prompt.** No hook checks that a conversation wrote to the log, and no workstream closes by itself. A log that conversations neglect is wrong, and others will act on it. A workstream that is never marked done stays in the index.
- **Words have no index.** A search reads the newest 50 pages, 10,000 entries, for each call. Older entries are found with a period, or by reading on call after call.
- **A done workstream is found through the log,** not through the list. Words that are only in its description or its closing summary are not searched.
- **The newest 100 entries cover less time as the hive grows.** With a hundred conversations that each write once a minute, they are the last minute. The filters and the list of open workstreams then matter more than the plain read.
- **Nothing stops two conversations from answering each other forever.** Each message says whether a reply is expected, and the prompt says not to answer only to acknowledge.
- **A woken conversation pays for its whole context.** Its provider cache has usually expired.
- **A message is stored as an ordinary user message.** A program that shows the transcript shows it like a person's input, with the `<hivemind-message>` tag.
- **Conversations a task owns,** such as a subagent's, cannot be sent messages.
- **The first version is not carried over.** Its index and workstream documents are read as the new ones, but the log each workstream kept is dropped, and its done workstreams are no longer listed.
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
| `src/board.ts` | The four kinds of document, and the changes that keep them together |
| `src/log.ts` | Reading the log: which pages to open for a set of filters |
| `src/search.ts` | Matching the words of a query against titles and entries |
| `src/render.ts` | Entries, workstreams, lists and messages as the model reads them |
| `src/prompts.ts` | The tool descriptions, and loading the prompt section |
| `src/tools/` | The eight tools |
