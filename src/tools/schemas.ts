import { parameters } from "./shared.ts";

/** The objects scripts get from the tools, as JSON Schemas. Codemode shows them as types, with these descriptions. */

const string = (description?: string) => (description === undefined ? { type: "string" } : { type: "string", description });
const integer = (description?: string) => (description === undefined ? { type: "integer" } : { type: "integer", description });
const array = (items: object, description?: string) => (description === undefined ? { type: "array", items } : { type: "array", items, description });

const YOU = integer("This conversation's id.");
const ID = string('Workstream id, such as "ws-12".');
const STATUS = { type: "string", enum: ["open", "done"] };
const TIME = string("ISO time.");
const ERROR = (then: string) => string(`Why the call was refused; ${then}.`);
const OLDER = integer("Present when older entries exist that were not read: pass it as `before` to read on.");

const ENTRY = { n: integer("Number of the entry in the log."), at: TIME, by: integer("Id of the conversation that wrote it."), text: string() };

export const WRITE_LOG_OUTPUT = parameters(
  {
    n: integer("Number of the new entry."),
    warning: string("Present when the entry was written but is longer than it may be."),
  },
  ["warning"],
);

export const READ_LOG_OUTPUT = parameters(
  {
    you: YOU,
    total: integer("How many entries the log has."),
    entries: array(parameters({ ...ENTRY, workstream: string('The workstream it is about, such as "ws-12", when it names one.') }, ["workstream"]), "The entries, oldest first."),
    older: OLDER,
    matchedWords: integer("Present when no entry has every word of `query`: how many of its words the entries have."),
    error: ERROR("`entries` is then empty"),
  },
  ["older", "matchedWords", "error"],
);

export const LIST_WORKSTREAMS_OUTPUT = parameters(
  {
    you: YOU,
    total: integer("How many open workstreams match; `workstreams` holds the first of them."),
    workstreams: array(
      parameters({
        id: ID,
        title: string(),
        updatedAt: string("ISO time its description, an involvement or its status last changed."),
        involved: array(integer(), "Ids of the conversations involved."),
        description: string(),
      }),
    ),
    error: ERROR("`workstreams` is then empty"),
  },
  ["error"],
);

export const READ_WORKSTREAM_OUTPUT = parameters(
  {
    you: YOU,
    workstream: parameters(
      {
        id: ID,
        title: string(),
        status: STATUS,
        updatedAt: TIME,
        description: string(),
        summary: string("The closing summary, when it is done or was done before."),
        involved: array(
          parameters({ conversation: integer(), part: string("Its own account of its part."), since: TIME }),
          "Every conversation involved, earliest first.",
        ),
        entries: array(parameters(ENTRY), "The newest log entries about it, oldest first."),
        older: OLDER,
      },
      ["summary", "older"],
    ),
    error: ERROR("`workstream` is then absent"),
  },
  ["workstream", "error"],
);

export const OPEN_WORKSTREAM_OUTPUT = parameters(
  {
    id: string("Id of the new workstream."),
    similar: array(parameters({ id: ID, title: string() }), "Open workstreams with similar titles."),
    error: ERROR("nothing was opened and `id` is absent"),
  },
  ["id", "error"],
);

export const UPDATE_WORKSTREAM_OUTPUT = parameters(
  {
    changed: array(string(), 'What was done, such as "rewrote the description".'),
    error: ERROR("nothing changed"),
  },
  ["error"],
);

export const SEND_MESSAGE_OUTPUT = parameters(
  {
    sent: { type: "boolean" },
    error: ERROR("nothing was sent"),
  },
  ["error"],
);

const PART = parameters({ id: ID, title: string(), part: string("The conversation's own account of its part.") });

export const WHOAMI_OUTPUT = parameters(
  {
    you: YOU,
    copyOf: integer("The conversation this one started as a copy of, when it is a copy."),
    workstreams: array(PART, "The open workstreams you are involved in, most recently changed first."),
    copyOfWorkstreams: array(PART, "The open workstreams the conversation in `copyOf` is involved in."),
  },
  ["copyOf", "copyOfWorkstreams"],
);
