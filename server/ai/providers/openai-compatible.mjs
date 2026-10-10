// Any service with OpenAI-style /models and /chat/completions endpoints.
// Mistral builds on this file; presets cover common hosted services.
import { AIError, send, sse, parseArguments, grow } from "../http.mjs";

export const PRESETS = [
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/settings/keys" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys" },
  { id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai/" },
  { id: "github", name: "GitHub Models", baseUrl: "https://models.github.ai/inference", modelsUrl: "https://models.github.ai/catalog/models", keyUrl: "https://github.com/settings/personal-access-tokens/new" },
  { id: "nvidia", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", keyUrl: "https://build.nvidia.com/" },
];

const NOT_CHAT = /embed|moderation|ocr|whisper|tts|transcri|speech|guard|rerank|dall-e|image|audio|realtime|vision-only|clip/i;
const trimBase = (url) => String(url || "").replace(/\/+$/, "");

/** Whether a model says it can call tools: true, false, or null when the service doesn't say. */
function toolSupport(m) {
  if (typeof m?.capabilities?.function_calling === "boolean") return m.capabilities.function_calling;
  if (Array.isArray(m?.capabilities)) return m.capabilities.includes("tool-calling") || m.capabilities.includes("tools");
  if (Array.isArray(m?.supported_parameters)) return m.supported_parameters.includes("tools");
  return null;
}

export async function listOpenAIModels(account, { label, signal, modelsUrl, filter = () => true }) {
  const res = await send(label, modelsUrl || trimBase(account.baseUrl) + "/models", {
    headers: headers(account), signal,
  });
  const body = await res.json().catch(() => null);
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
  if (!list) throw new AIError(`${label} returned an unexpected model list.`, "invalid_models", 502);
  return list
    .filter((m) => typeof m?.id === "string" && !NOT_CHAT.test(m.id) && m.active !== false && filter(m))
    .map((m) => ({ id: m.id, name: typeof m.name === "string" && m.name ? m.name : m.id, tools: toolSupport(m) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function headers(account) {
  return {
    ...(account.apiKey ? { Authorization: "Bearer " + account.apiKey } : {}),
    "X-Title": "Slate",
  };
}

/** Slate's conversation in OpenAI chat format. `mapId` adapts tool-call ids for strict services. */
export function toOpenAIMessages(system, messages, mapId = (id) => id) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content || (m.toolCalls?.length ? "" : " "),
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({
          id: mapId(c.id), type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) },
        })) } : {}),
      });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: mapId(m.toolCallId), name: m.name, content: m.content });
  }
  return out;
}

export async function streamOpenAIChat(account, { label, model, system, messages, tools, signal, onText, mapId, url, extra = {} }) {
  const res = await send(label, url || trimBase(account.baseUrl) + "/chat/completions", {
    method: "POST", signal,
    headers: { ...headers(account), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model, stream: true, messages: toOpenAIMessages(system, messages, mapId),
      ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      ...extra,
    }),
  }, { timeout: 180000 });
  let text = "", finished = false;
  const calls = [];
  for await (const { data } of sse(res, signal, label)) {
    if (data?.error) throw new AIError(`${label} stopped with an error: ${String(data.error.message || data.error).slice(0, 300)}`, "upstream_error", 502);
    const choice = data?.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    if (typeof delta.content === "string" && delta.content) {
      text = grow(text, delta.content, label);
      onText(delta.content);
    }
    for (const part of delta.tool_calls || []) {
      const index = Number.isInteger(part.index) ? part.index : calls.length;
      const call = (calls[index] ||= { id: "", name: "", args: "" });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      if (typeof part.function?.arguments === "string") call.args += part.function.arguments;
      else if (part.function?.arguments && typeof part.function.arguments === "object") call.args = JSON.stringify(part.function.arguments);
    }
    if (choice.finish_reason) finished = true;
  }
  if (!finished && !text && !calls.length)
    throw new AIError(`The connection to ${label} ended before the reply finished. Try again.`, "interrupted_response", 502);
  const toolCalls = calls.filter(Boolean).map((c, i) => ({
    id: c.id || `call_${i}_${Date.now().toString(36)}`, name: c.name, arguments: parseArguments(c.args, label),
  }));
  if (!text.trim() && !toolCalls.length)
    throw new AIError(`${label} finished without an answer. Try a different question or model.`, "empty_response", 502);
  return { text, toolCalls };
}

/** An address the user typed for a service. Keys only go to https, or to this computer. */
export function checkBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw new AIError("Enter the service's address, like https://api.example.com/v1.", "invalid_base_url"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && local)))
    throw new AIError("The address must start with https:// (or http://localhost for a service on this computer).", "invalid_base_url");
  return trimBase(url.href);
}

export default {
  type: "openai-compatible",
  label: "OpenAI-compatible",
  custom: true,
  needsKey: true,
  presets: PRESETS,
  async listModels(account, { signal }) {
    const preset = PRESETS.find((p) => trimBase(p.baseUrl) === trimBase(account.baseUrl));
    return listOpenAIModels(account, { label: account.name, signal, modelsUrl: preset?.modelsUrl });
  },
  stream(account, options) {
    return streamOpenAIChat(account, { ...options, label: account.name });
  },
};
