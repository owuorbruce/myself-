// Gemini through the Google AI (Generative Language) API with an API key.
import { AIError, send, sse, grow } from "../http.mjs";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini accepts a subset of JSON Schema: drop the keywords it rejects. */
export function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["additionalProperties", "$schema", "default", "examples", "maxLength", "minLength", "pattern"].includes(key)) continue;
    out[key] = key === "properties"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, geminiSchema(v)]))
      : geminiSchema(value);
  }
  return out;
}

/** Slate's conversation as Gemini contents. Gemini's own earlier turns are replayed as sent. */
export function toGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.content }] });
    else if (m.role === "assistant") {
      const parts = m.native?.type === "gemini" && Array.isArray(m.native.parts) ? m.native.parts : [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.toolCalls || []).map((c) => ({ functionCall: { name: c.name, args: c.arguments || {} } })),
      ];
      if (parts.length) contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      const part = { functionResponse: { name: m.name, response: { result: m.content } } };
      const last = contents[contents.length - 1];
      // Answers to several calls from one turn go together.
      if (last?.role === "user" && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  return contents;
}

export default {
  type: "gemini",
  label: "Gemini",
  needsKey: true,
  keyUrl: "https://aistudio.google.com/apikey",
  async listModels(account, { signal }) {
    const res = await send("Gemini", BASE + "/models?pageSize=1000", { headers: { "x-goog-api-key": account.apiKey }, signal });
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body?.models)) throw new AIError("Gemini returned an unexpected model list.", "invalid_models", 502);
    return body.models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && typeof m.name === "string" &&
        !/embedding|aqa|imagen|veo|tts|image|audio|live|robotics/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name.replace(/^models\//, ""), tools: !/gemma/i.test(m.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async stream(account, { model, system, messages, tools, signal, onText }) {
    if (!/^[\w.-]+$/.test(model)) throw new AIError("Choose a Gemini model from the list.", "invalid_model");
    const res = await send("Gemini", `${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST", signal,
      headers: { "x-goog-api-key": account.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: toGeminiContents(messages),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }] } : {}),
      }),
    }, { timeout: 180000 });
    let text = "", finish = "";
    const parts = [], toolCalls = [];
    for await (const { data } of sse(res, signal, "Gemini")) {
      if (data?.error) throw new AIError(`Gemini stopped with an error: ${String(data.error.message || "").slice(0, 300)}`, "upstream_error", 502);
      if (data?.promptFeedback?.blockReason) throw new AIError("Gemini declined to answer this request.", "blocked", 400);
      const candidate = data?.candidates?.[0];
      for (const part of candidate?.content?.parts || []) {
        parts.push(part);
        if (typeof part.text === "string" && !part.thought) {
          text = grow(text, part.text, "Gemini");
          onText(part.text);
        }
        if (part.functionCall?.name)
          toolCalls.push({ id: `gemini_${toolCalls.length}_${Date.now().toString(36)}`, name: part.functionCall.name, arguments: part.functionCall.args || {} });
      }
      if (candidate?.finishReason) finish = candidate.finishReason;
    }
    if (finish && !["STOP", "MAX_TOKENS"].includes(finish) && !text && !toolCalls.length)
      throw new AIError(`Gemini stopped without an answer (${finish.toLowerCase().replace(/_/g, " ")}).`, "blocked", 400);
    if (!text.trim() && !toolCalls.length)
      throw new AIError("Gemini finished without an answer. Try a different question or model.", "empty_response", 502);
    // Keep Gemini's parts (with their thought signatures) to replay this turn.
    return { text, toolCalls, native: { type: "gemini", parts } };
  },
};
