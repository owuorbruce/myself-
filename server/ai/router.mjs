// /api/ai/*: provider settings, model lists and streamed chat for the Ask AI panel.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { AIError } from "./http.mjs";
import { Accounts, loadProviders } from "./providers.mjs";

const LIMITS = { messages: 120, chars: 400000, tools: 24, native: 300000 };

function equal(a, b) {
  return typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
async function bodyJSON(req, max = 2_000_000) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new AIError("JSON is required for this request.", "invalid_request", 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) throw new AIError("This conversation is too long. Start a new chat with fewer notes.", "request_too_large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AIError("Couldn't read this request.", "invalid_request"); }
}
const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
};
const str = (v, max) => typeof v === "string" && v.length <= max;

/** Check a chat request from the panel. */
export function validateChat(body) {
  if (!body || !str(body.account, 80) || !body.account || !str(body.model, 200) || !body.model)
    throw new AIError("Choose a model first.", "invalid_request");
  if (body.system !== undefined && !str(body.system, LIMITS.chars)) throw new AIError("The note context is too long.", "context_too_large", 413);
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > LIMITS.messages)
    throw new AIError("This conversation is too long. Start a new chat.", "invalid_request");
  let chars = (body.system || "").length;
  const ids = new Set();
  const out = messages.map((m) => {
    if (m?.role === "user" && str(m.content, LIMITS.chars) && m.content.trim()) {
      chars += m.content.length;
      return { role: "user", content: m.content };
    }
    if (m?.role === "assistant" && str(m.content ?? "", LIMITS.chars)) {
      const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
      if (toolCalls.length > 20 || !toolCalls.every((c) => str(c?.id, 200) && str(c?.name, 64) && c.arguments && typeof c.arguments === "object" && !Array.isArray(c.arguments)))
        throw new AIError("This conversation contains an invalid tool request.", "invalid_request");
      toolCalls.forEach((c) => ids.add(c.id));
      chars += (m.content || "").length + JSON.stringify(toolCalls).length;
      const native = m.native && typeof m.native === "object" && typeof m.native.type === "string" &&
        JSON.stringify(m.native).length <= LIMITS.native ? m.native : undefined;
      if (!m.content && !toolCalls.length) throw new AIError("This conversation contains an empty reply.", "invalid_request");
      return { role: "assistant", content: m.content || "", ...(toolCalls.length ? { toolCalls } : {}), ...(native ? { native } : {}) };
    }
    if (m?.role === "tool" && str(m.toolCallId, 200) && ids.has(m.toolCallId) && str(m.name, 64) && str(m.content, LIMITS.chars)) {
      chars += m.content.length;
      return { role: "tool", toolCallId: m.toolCallId, name: m.name, content: m.content };
    }
    throw new AIError("This conversation contains an invalid message.", "invalid_request");
  });
  if (chars > LIMITS.chars) throw new AIError("This conversation is too long. Start a new chat with fewer notes.", "context_too_large", 413);
  const tools = body.tools === undefined ? [] : body.tools;
  if (!Array.isArray(tools) || tools.length > LIMITS.tools || !tools.every((t) =>
    str(t?.name, 64) && /^[a-z_][a-z0-9_]*$/.test(t.name) && str(t.description, 2000) && t.parameters && typeof t.parameters === "object"))
    throw new AIError("This request lists invalid tools.", "invalid_request");
  return { account: body.account, model: body.model, system: body.system || "", messages: out, tools };
}

export function createAIRouter({ runtime, accounts = new Accounts() } = {}) {
  const requestToken = randomBytes(32).toString("base64url");
  const running = new Set();
  async function account(id) {
    if (id === "chatgpt") {
      const status = runtime ? await runtime.status() : null;
      if (!status?.planEnabled) throw new AIError("Connect ChatGPT in Settings & backups → AI providers first.", "not_connected", 403);
      return { id: "chatgpt", type: "chatgpt", name: "ChatGPT", runtime };
    }
    const providers = await loadProviders();
    const saved = await accounts.get(id);
    if (saved) return saved;
    // Ollama works without being set up first, at its usual address.
    const local = [...providers.values()].find((p) => p.type === id && p.local);
    if (local) return { id, type: id, name: local.label, baseUrl: local.defaultBaseUrl };
    throw new AIError("That AI provider isn't connected. Add it in Settings & backups → AI providers.", "not_connected", 404);
  }
  const route = async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/ai/")) return false;
    // Reject DNS rebinding and other websites, including other local ports.
    const port = req.socket.localPort;
    const origin = req.headers.origin;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host) ||
      (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin)) ||
      req.headers["sec-fetch-site"] === "cross-site") {
      json(res, { error: "Open Slate using its local address.", code: "origin_rejected" }, 403);
      return true;
    }
    try {
      if (url.pathname === "/api/ai/session" && req.method === "GET") { json(res, { available: true, requestToken }); return true; }
      if (!equal(req.headers["x-slate-token"], requestToken)) throw new AIError("Reload Slate and try again.", "request_rejected", 403);
      const providers = await loadProviders();
      if (url.pathname === "/api/ai/providers" && req.method === "GET") {
        const status = runtime ? await runtime.status().catch(() => null) : null;
        json(res, {
          providers: [...providers.values()].map((p) => ({ type: p.type, label: p.label, needsKey: !!p.needsKey, local: !!p.local,
            custom: !!p.custom, signIn: !!p.signIn, keyUrl: p.keyUrl || "", defaultBaseUrl: p.defaultBaseUrl || "", presets: p.presets || [],
            editableBaseUrl: !!p.editableBaseUrl, regions: p.regions || [], preferredModel: p.preferredModel?.source || "" })),
          accounts: (await accounts.all()).map(Accounts.summary),
          chatgpt: { connected: !!status?.planEnabled, account: status?.account || "" },
        });
        return true;
      }
      if (url.pathname === "/api/ai/models" && req.method === "GET") {
        const target = await account(url.searchParams.get("account") || "");
        const provider = providers.get(target.type);
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        json(res, { models: await provider.listModels(target, { signal: controller.signal }) });
        return true;
      }
      if (req.method !== "POST") { json(res, { error: "Method not allowed." }, 405); return true; }
      if (url.pathname === "/api/ai/providers/save") { json(res, { account: await accounts.save(await bodyJSON(req, 20000), providers) }); return true; }
      if (url.pathname === "/api/ai/providers/remove") {
        const body = await bodyJSON(req, 20000);
        if (!str(body?.id, 80)) throw new AIError("Choose a provider to remove.", "invalid_request");
        await accounts.remove(body.id);
        json(res, { ok: true });
        return true;
      }
      if (url.pathname === "/api/ai/check-tools") {
        // A real, tiny request: does this model call a tool when asked to?
        const body = await bodyJSON(req, 20000);
        if (!str(body?.account, 80) || !str(body?.model, 200)) throw new AIError("Choose a model to check.", "invalid_request");
        const target = await account(body.account);
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        let result;
        try {
          result = await providers.get(target.type).stream(target, {
            model: body.model, system: "You are testing tool calling. Call the tool you are given.", signal: controller.signal, onText: () => {},
            messages: [{ role: "user", content: "Call get_today now. Do not answer in text." }],
            tools: [{ name: "get_today", description: "Returns today's date.", parameters: { type: "object", properties: {}, additionalProperties: false } }],
          });
        } catch (error) {
          if (error instanceof AIError && error.code === "upstream_error" && error.status === 400) { json(res, { tools: false, detail: error.message }); return true; }
          throw error;
        }
        json(res, { tools: result.toolCalls.some((c) => c.name === "get_today") });
        return true;
      }
      if (url.pathname === "/api/ai/chat") {
        const input = validateChat(await bodyJSON(req));
        const target = await account(input.account);
        const provider = providers.get(target.type);
        if (!provider) throw new AIError("That AI provider isn't available in this version of Slate.", "not_connected", 404);
        const controller = new AbortController();
        running.add(controller);
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.on("close", cancel);
        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.flushHeaders();
        const emit = (item) => { if (!res.destroyed) res.write(JSON.stringify(item) + "\n"); };
        try {
          const result = await provider.stream(target, { ...input, signal: controller.signal, onText: (text) => emit({ type: "delta", text }) });
          if (!controller.signal.aborted) emit({ type: "done", text: result.text, toolCalls: result.toolCalls || [], ...(result.native ? { native: result.native } : {}) });
        } catch (error) {
          emit({ type: "error", ...describe(error) });
        } finally {
          running.delete(controller);
          res.off("close", cancel);
          res.end();
        }
        return true;
      }
      json(res, { error: "Not found." }, 404);
    } catch (error) {
      const info = describe(error);
      json(res, info, error instanceof AIError ? error.status : 500);
    }
    return true;
  };
  route.close = () => { for (const c of running) c.abort(); };
  return route;
}

function describe(error) {
  if (error instanceof AIError || (error && typeof error.code === "string" && typeof error.status === "number"))
    return { error: error.message, code: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) };
  return { error: "Couldn't complete the AI request. Try again.", code: "local_error" };
}
