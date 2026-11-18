import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, Harness, MemoryStorage, type Conversation } from "@earendil-works/pi-durable";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { createHivemindExtension, DirectoryDoc, IndexDoc, LogPageDoc, resolveConfig, WorkstreamDoc, type DirectoryPiece, type HivemindConfig, type Index, type LogPage, type Workstream } from "../src/index.ts";
import { appendEntry, workstreamForUpdate } from "../src/board.ts";
import { readLog, type LogQuery, type LogSource } from "../src/log.ts";

export const ctx = BACKGROUND_CONTEXT;

/** Plain text of one provider-facing message. */
export function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" ? part.text : part.type === "toolCall" ? `[call ${part.name}]` : "")).join("\n");
}

/**
 * The model of the tests. A message that contains "call <tool> <json>" makes it call that tool with those arguments,
 * also when the message came from another conversation; anything else gets a short answer.
 */
function respond(messages: readonly Message[]): AssistantMessage {
  const last = messages[messages.length - 1]!;
  if (last.role === "toolResult") return fauxAssistantMessage("ok");
  const call = /call (\w+) (\{.*\})/s.exec(textOf(last));
  if (call !== null) return fauxAssistantMessage(fauxToolCall(call[1]!, JSON.parse(call[2]!)), { stopReason: "toolUse" });
  return fauxAssistantMessage("Understood.");
}

/** Creates a conversation that a task owns, as a subagent tool would, and answers with its id. */
const spawn = defineTool({
  name: "spawn",
  description: "Create a conversation owned by this call.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, api, context) => {
    const child = await api.commit((tx) => tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } }), context);
    return { output: [{ type: "text", text: `spawned ${child.id}` }] };
  },
});

/** Takes a moment, so a test can reach a conversation while it is working. */
const pause = defineTool({
  name: "pause",
  description: "Wait a moment.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { output: [{ type: "text", text: "waited" }] };
  },
});

/** A harness with Hivemind and as many conversations as asked for, all on the same scripted model. */
export async function setup(config: Partial<HivemindConfig> = {}, options: { conversations?: number; codemode?: boolean } = {}) {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  /** The system messages of every request, as one text each. */
  const systems: string[] = [];
  faux.setResponses(
    Array.from({ length: 400 }, () => (context: { messages: Message[] }) => {
      systems.push(JSON.stringify(context.messages.filter((message) => message.role === "system")));
      return respond(context.messages.filter((message) => message.role !== "system"));
    }),
  );
  const registry = createRegistry();
  registry.install(defineExtension({ name: "test-tools", tools: [spawn, pause] }));
  // The eight declarations take about 2,900 tokens; the default budget of the section, 3,000, would leave some out.
  if (options.codemode) registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox(), inlineBudget: 6000 }));
  registry.install(createHivemindExtension(config));
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
  const agent = { model: { provider: faux.provider.id, modelId: faux.provider.getModels()[0]!.id } };
  const conversations: Conversation[] = [await harness.root(ctx, { agent })];
  for (let i = 1; i < (options.conversations ?? 2); i++) {
    conversations.push(await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, ctx));
  }

  /** Send a user message, and wait until every conversation is idle again. */
  const say = async (conversation: Conversation, text: string) => {
    const settled = await (await conversation.submit({ type: "input", content: text }, ctx)).wait(ctx);
    await harness.waitForIdle(ctx);
    return settled.status;
  };
  /** What the model of a conversation would be sent now, without the system message. */
  const messages = async (conversation: Conversation) => (await conversation.context(ctx)).messages.filter((message) => message.role !== "system");
  /** Have a conversation call a tool, and return the text of the result it read. */
  const call = async (conversation: Conversation, tool: string, args: Record<string, unknown>) => {
    await say(conversation, `call ${tool} ${JSON.stringify(args)}`);
    const results = (await messages(conversation)).filter((message) => message.role === "toolResult");
    return textOf(results[results.length - 1]!);
  };
  /** A copy of a conversation as it is now, under a new id, as a thread started from it would be. */
  const fork = async (conversation: Conversation) => {
    const at = await conversation.commit((tx) => tx.latestEntryId(conversation.id), ctx);
    return conversation.fork(at!, { ownership: { kind: "ownerless" } }, ctx);
  };
  const index = async () => (await harness.snapshot(IndexDoc, ctx)) as Index | undefined;
  const workstream = async (id: number) => (await harness.snapshot(WorkstreamDoc, String(id), ctx)) as Workstream | undefined;
  const page = async (number: number) => (await harness.snapshot(LogPageDoc, String(number), ctx)) as LogPage | undefined;
  const piece = async (number: number) => (await harness.snapshot(DirectoryDoc, String(number), ctx)) as DirectoryPiece | undefined;
  const resolved = resolveConfig(config);
  /** Write an entry as the tool would, at a chosen time and as a chosen conversation. Returns its number. */
  const write = (by: number, text: string, at: number, about?: number) =>
    conversations[0]!.commit(async (tx) => {
      const tagged = about === undefined ? undefined : await workstreamForUpdate(tx, about);
      return appendEntry(tx, resolved, { by, at, text, ...(tagged === undefined ? {} : { workstream: tagged }) });
    }, ctx);
  const source: LogSource = { index, page, piece, workstream };
  /** Read the log as the tools do. */
  const read = (query: Partial<LogQuery> = {}) => readLog(source, resolved.scanPages, { limit: resolved.readLimit, ...query });
  return { harness, conversations, say, call, messages, fork, index, workstream, page, piece, write, read, systems, close: () => harness.close(ctx) };
}
