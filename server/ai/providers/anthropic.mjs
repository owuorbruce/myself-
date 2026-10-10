// Claude through the Anthropic API with an API key.
import { AIError, send, sse, parseArguments, grow } from "../http.mjs";

const BASE = "https://api.anthropic.com/v1";
const headers = (account) => ({ "x-api-key": account.apiKey, "anthropic-version": "2023-06-01" });

export function toAnthropicMessages(messages) {
  const out = [];
  const push = (role, block) => {
    const last = out[out.length - 1];
    if (last?.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", { type: "text", text: m.content });
    else if (m.role === "assistant") {
      if (m.content) push("assistant", { type: "text", text: m.content });
      for (const c of m.toolCalls || []) push("assistant", { type: "tool_use", id: anthropicId(c.id), name: c.name, input: c.arguments || {} });
    } else if (m.role === "tool") push("user", { type: "tool_result", tool_use_id: anthropicId(m.toolCallId), content: m.content });
  }
  return out;
}
const anthropicId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "call";

export default {
  type: "anthropic",
  label: "Claude",
  needsKey: true,
  keyUrl: "https://console.anthropic.com/settings/keys",
  async listModels(account, { signal }) {
    const res = await send("Claude", BASE + "/models?limit=1000", { headers: headers(account), signal });
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body?.data)) throw new AIError("Claude returned an unexpected model list.", "invalid_models", 502);
    return body.data
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id, name: m.display_name || m.id, tools: true }));
  },
  async stream(account, { model, system, messages, tools, signal, onText }) {
    const res = await send("Claude", BASE + "/messages", {
      method: "POST", signal,
      headers: { ...headers(account), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model, max_tokens: 8192, stream: true,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(messages),
        ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      }),
    }, { timeout: 180000 });
    let text = "", stop = "";
    const blocks = [];
    for await (const { data } of sse(res, signal, "Claude")) {
      if (data?.type === "error") {
        if (data.error?.type === "overloaded_error") throw new AIError("Claude is overloaded right now. Try again in a little while.", "overloaded", 503);
        throw new AIError(`Claude stopped with an error: ${String(data.error?.message || "").slice(0, 300)}`, "upstream_error", 502);
      }
      if (data?.type === "content_block_start") blocks[data.index] = { ...data.content_block, json: "" };
      else if (data?.type === "content_block_delta") {
        const block = blocks[data.index];
        if (data.delta?.type === "text_delta") {
          text = grow(text, data.delta.text, "Claude");
          onText(data.delta.text);
        } else if (data.delta?.type === "input_json_delta" && block) block.json += data.delta.partial_json;
      } else if (data?.type === "message_delta" && data.delta?.stop_reason) stop = data.delta.stop_reason;
    }
    if (!stop) throw new AIError("The connection to Claude ended before the reply finished. Try again.", "interrupted_response", 502);
    if (stop === "refusal" && !text) throw new AIError("Claude declined to answer this request.", "blocked", 400);
    const toolCalls = blocks.filter((b) => b?.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: b.json ? parseArguments(b.json, "Claude") : b.input || {} }));
    if (!text.trim() && !toolCalls.length) throw new AIError("Claude finished without an answer. Try a different question or model.", "empty_response", 502);
    return { text, toolCalls };
  },
};
