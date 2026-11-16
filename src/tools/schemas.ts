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

export const LIST_OUTPUT = parameters(
  {
    you: YOU,
    total: integer("How many workstreams match; `workstreams` holds the first of them."),
    workstreams: array(
      parameters(
        {
          id: ID,
          title: string(),
          status: STATUS,
          updatedAt: TIME,
          involved: array(integer(), "Ids of the conversations involved."),
          description: string(),
          summary: string("The closing summary, when it is done."),
        },
        ["summary"],
      ),
    ),
    error: ERROR("`workstreams` is then empty"),
  },
  ["error"],
);

export const READ_OUTPUT = parameters(
  {
    you: YOU,
    workstream: parameters(
      {
        id: ID,
        title: string(),
        status: STATUS,
        updatedAt: TIME,
        description: string(),
        summary: string("The closing summary, when it is done."),
        involved: array(
          parameters({ conversation: integer(), part: string("Its own account of its part."), since: TIME }),
          "Every conversation involved, earliest first.",
        ),
        log: array(parameters({ n: integer("Number of the entry."), at: TIME, by: integer("Id of the conversation that wrote it."), text: string() }), "One page of the log, oldest first."),
        logTotal: integer("How many log entries there are in all."),
      },
      ["summary"],
    ),
    error: ERROR("`workstream` is then absent"),
  },
  ["workstream", "error"],
);

export const OPEN_OUTPUT = parameters(
  {
    id: string("Id of the new workstream."),
    similar: array(parameters({ id: ID, title: string() }), "Open workstreams with similar titles."),
    error: ERROR("nothing was opened and `id` is absent"),
  },
  ["id", "error"],
);

export const UPDATE_OUTPUT = parameters(
  {
    changed: array(string(), 'What was done, such as "added log entry 4".'),
    error: ERROR("nothing changed"),
  },
  ["error"],
);

export const MESSAGE_OUTPUT = parameters(
  {
    sent: { type: "boolean" },
    error: ERROR("nothing was sent"),
  },
  ["error"],
);

const PART = parameters({ id: ID, title: string(), status: STATUS, part: string("The conversation's own account of its part.") });

export const WHOAMI_OUTPUT = parameters(
  {
    you: YOU,
    copyOf: integer("The conversation this one started as a copy of, when it is a copy."),
    workstreams: array(PART, "The workstreams you are involved in, open ones first."),
    copyOfWorkstreams: array(PART, "The workstreams the conversation in `copyOf` is involved in."),
  },
  ["copyOf", "copyOfWorkstreams"],
);
