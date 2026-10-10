// ChatGPT through the existing "Sign in with ChatGPT" plan connection
// (server/chatgpt-auth.mjs). No API key; sign-in is unchanged.
//
// Tools: OpenAI's preview notes for this route say function tools must be
// grouped in a namespace. Slate sends them that way; until a real account
// confirms it, models are listed with tool support "unknown" and Slate falls
// back to answers only if the request is refused.
import { AIError, sse, parseArguments, grow } from "../http.mjs";
import { ChatGPTError, responseError } from "../../chatgpt-auth.mjs";

export const NAMESPACE = "slate";
const INSTRUCTIONS = "You are Slate's study and writing assistant.";

export function toResponsesInput(messages) {
  const input = [];
  for (const m of messages) {
    if (m.role === "user") input.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls || [])
        input.push({ type: "function_call", call_id: c.id, name: c.name, namespace: NAMESPACE, arguments: JSON.stringify(c.arguments || {}) });
    } else if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
  }
  return input;
}

const wrap = (error) => {
  if (!(error instanceof ChatGPTError)) return error;
  if (error.status === 429 || /usage_limit/.test(error.code))
    return new AIError(error.message || "Your ChatGPT plan's usage limit was reached. Try again after it resets.", "rate_limited", 429);
  return new AIError(error.message, error.code, error.status);
};

export default {
  type: "chatgpt",
  label: "ChatGPT",
  needsKey: false,
  signIn: true,
  async listModels(account) {
    try {
      return (await account.runtime.models()).map((m) => ({ ...m, tools: null }));
    } catch (error) { throw wrap(error); }
  },
  async stream(account, { model, system, messages, tools, signal, onText }) {
    const runtime = account.runtime;
    let res;
    try {
      const models = await runtime.models();
      if (!models.some((m) => m.id === model)) throw new AIError("Choose a model available to your connected ChatGPT account.", "invalid_model");
      res = await runtime.api("/responses", {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model, store: false, stream: true,
          instructions: system || INSTRUCTIONS,
          input: toResponsesInput(messages),
          ...(tools?.length ? { tools: [{ type: "namespace", name: NAMESPACE, description: "Read and propose changes to the user's Slate notes.",
            tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
        }),
      });
    } catch (error) { throw wrap(error); }
    let text = "", completed = false;
    const toolCalls = [];
    try {
      for await (const { event, data } of sse(res, signal, "ChatGPT")) {
        const type = data?.type || event;
        if (type === "response.output_text.delta" && typeof data.delta === "string") {
          text = grow(text, data.delta, "ChatGPT");
          onText(data.delta);
        } else if (type === "response.output_item.done" && data.item?.type === "function_call") {
          toolCalls.push({ id: data.item.call_id || data.item.id, name: data.item.name, arguments: parseArguments(data.item.arguments, "ChatGPT") });
        } else if (type === "response.failed" || type === "error") throw responseError(data.response || data, 502);
        else if (type === "response.incomplete") throw new AIError("ChatGPT stopped before finishing the answer. Please try again.", "incomplete_response", 502);
        else if (type === "response.completed") {
          completed = true;
          if (!text && !toolCalls.length)
            for (const item of data.response?.output || []) {
              if (item.type === "function_call")
                toolCalls.push({ id: item.call_id || item.id, name: item.name, arguments: parseArguments(item.arguments, "ChatGPT") });
              for (const part of item.content || []) {
                const piece = part.type === "output_text" ? part.text : part.type === "refusal" ? part.refusal : "";
                if (typeof piece === "string" && piece) { text += piece; onText(piece); }
              }
            }
          break;
        }
      }
    } catch (error) { throw wrap(error); }
    if (!completed) throw new AIError("The connection ended before ChatGPT finished. Try again; the partial answer wasn't saved.", "interrupted_response", 502);
    if (!text.trim() && !toolCalls.length) throw new AIError("ChatGPT finished without a text answer. Try a different question or model.", "empty_response", 502);
    return { text, toolCalls };
  },
};
