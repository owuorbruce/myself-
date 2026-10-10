// Models running on this computer with Ollama (https://ollama.com). No key; works offline.
import { AIError, send, ndjson, grow } from "../http.mjs";

export const OLLAMA_URL = "http://localhost:11434";
const base = (account) => String(account.baseUrl || OLLAMA_URL).replace(/\/+$/, "");

function toOllamaMessages(system, messages) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({ role: "assistant", content: m.content || "",
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments || {} } })) } : {}) });
    else if (m.role === "tool") out.push({ role: "tool", content: m.content, tool_name: m.name });
  }
  return out;
}

export default {
  type: "ollama",
  label: "Ollama",
  needsKey: false,
  local: true,
  defaultBaseUrl: OLLAMA_URL,
  async listModels(account, { signal }) {
    let res;
    try { res = await send("Ollama", base(account) + "/api/tags", { signal }, { timeout: 5000 }); }
    catch (error) {
      if (error.code === "network_error" || error.code === "timeout")
        throw new AIError("Ollama isn't running on this computer. Start Ollama, then reload the model list.", "not_running", 503);
      throw error;
    }
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body?.models)) throw new AIError("Ollama returned an unexpected model list.", "invalid_models", 502);
    const models = body.models.filter((m) => typeof m.name === "string" && !/embed/i.test(m.name));
    // Ask each model whether it can call tools; older Ollama versions don't say.
    return Promise.all(models.map(async (m) => {
      let tools = null;
      try {
        const info = await (await send("Ollama", base(account) + "/api/show", {
          method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m.name }),
        }, { timeout: 5000 })).json();
        if (Array.isArray(info?.capabilities)) tools = info.capabilities.includes("tools");
      } catch { /* leave unknown */ }
      return { id: m.name, name: m.name, tools };
    }));
  },
  async stream(account, { model, system, messages, tools, signal, onText }) {
    let res;
    try {
      res = await send("Ollama", base(account) + "/api/chat", {
        method: "POST", signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, stream: true, messages: toOllamaMessages(system, messages),
          ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
        }),
      }, { timeout: 600000 });
    } catch (error) {
      if (error.code === "network_error") throw new AIError("Ollama isn't running on this computer. Start Ollama and try again.", "not_running", 503);
      throw error;
    }
    let text = "", done = false;
    const toolCalls = [];
    for await (const data of ndjson(res, signal, "Ollama")) {
      if (data.error) throw new AIError(`Ollama stopped with an error: ${String(data.error).slice(0, 300)}`, "upstream_error", 502);
      const piece = data.message?.content;
      if (typeof piece === "string" && piece) {
        text = grow(text, piece, "Ollama");
        onText(piece);
      }
      for (const c of data.message?.tool_calls || [])
        if (c.function?.name)
          toolCalls.push({ id: `ollama_${toolCalls.length}_${Date.now().toString(36)}`, name: c.function.name,
            arguments: typeof c.function.arguments === "object" && c.function.arguments ? c.function.arguments : {} });
      if (data.done) done = true;
    }
    if (!done) throw new AIError("Ollama stopped before the reply finished. Try again.", "interrupted_response", 502);
    if (!text.trim() && !toolCalls.length) throw new AIError("Ollama finished without an answer. Try a different model.", "empty_response", 502);
    return { text, toolCalls };
  },
};
