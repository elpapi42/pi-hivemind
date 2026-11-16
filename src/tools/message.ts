import { defineTool } from "@earendil-works/pi-durable";
import { asConversationId, IndexDoc } from "../board.ts";
import { LIMITS } from "../config.ts";
import { TOOL_DESCRIPTIONS } from "../prompts.ts";
import { envelope, ref } from "../render.ts";
import { answer, parameters, refuse, toConversationId, tooLong, toText, toWorkstreamId, WORKSTREAM_PARAMETER } from "./shared.ts";

export const MESSAGE_TOOL = "hivemind_message";

export function messageTool() {
  return defineTool({
    name: MESSAGE_TOOL,
    description: TOOL_DESCRIPTIONS.message,
    parameters: parameters(
      {
        to: { type: "integer", description: "Id of the conversation that receives the message." },
        text: { type: "string", description: "The message. It must stand alone: the receiver does not see your context." },
        reply: { type: "boolean", description: "Whether you expect an answer." },
        workstream: { ...WORKSTREAM_PARAMETER, description: 'Id of the workstream the message is about, such as "ws-12", when there is one.' },
      },
      ["workstream"],
    ),
    executionMode: "sequential",
    execute: async (args, api, context) => {
      const input = args as { to?: unknown; text?: unknown; reply?: unknown; workstream?: unknown };
      const self = api.conversationId as number;
      const to = toConversationId(input.to);
      if (Number.isNaN(to)) return refuse("`to` must be a conversation id, a number, as the blackboard shows it.");
      if (to === self) return refuse(`Conversation ${self} is you. A message goes to another conversation.`);
      const text = toText(input.text);
      if (text === undefined) return refuse("`text` is empty. Write the message.");
      const long = tooLong("text", text, LIMITS.message);
      if (long !== undefined) return refuse(long);
      if (typeof input.reply !== "boolean") return refuse("`reply` must be true or false: whether you expect an answer.");
      const workstream = input.workstream === undefined || input.workstream === null ? undefined : toWorkstreamId(input.workstream);
      if (workstream !== undefined && Number.isNaN(workstream)) return refuse('`workstream` must be a workstream id such as "ws-12".');

      const target = await api.commit(async (tx) => {
        const known = workstream === undefined || (await tx.doc(IndexDoc)).rows[String(workstream)] !== undefined;
        const record = await tx.conversation(asConversationId(to));
        return { known, exists: record !== undefined, owned: record?.owner !== undefined };
      }, context);
      if (!target.known) return refuse(`There is no workstream ${ref(workstream!)}. Leave \`workstream\` out, or call hivemind_list to find the right one.`);
      if (!target.exists) return refuse(`There is no conversation ${to}. Conversation ids are the numbers the blackboard shows under "involved".`);
      // A conversation a task created for itself, such as a subagent's, is driven by that task and takes no outside input.
      if (target.owned) return refuse(`Conversation ${to} belongs to a background task of another conversation and does not take messages.`);

      const handle = await api.conversation(asConversationId(to), context);
      if (handle === undefined) return refuse(`Conversation ${to} could not be reached.`);
      const content = envelope({ from: self, reply: input.reply, text, ...(workstream === undefined ? {} : { workstream }) });
      // A working conversation gets it after its current tool round; an idle one starts a run on it.
      await handle.submit({ type: "input", content, whenBusy: "steer" }, context);
      return answer(self, `Sent to conversation ${to}.${input.reply ? " Its answer will arrive later as a message to you; go on with your work, or end your turn if you have nothing else to do." : ""}`);
    },
  });
}
