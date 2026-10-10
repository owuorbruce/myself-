import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { createLocalServer } from "../server/local-server.mjs";
import { Accounts, accountStore, loadProviders } from "../server/ai/providers.mjs";
import { validateChat } from "../server/ai/router.mjs";

const memory = () => {
  let saved = null;
  return { read: async () => structuredClone(saved), write: async (d) => { saved = structuredClone(d); }, get value() { return saved; } };
};

async function server(t, { store = memory(), runtime } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "slate-ai-"));
  const local = createLocalServer({ root: dir, accounts: new Accounts({ store }), runtime });
  const origin = await local.listen(0);
  t.after(async () => { await local.close(); await rm(dir, { recursive: true, force: true }); });
  const { requestToken } = await (await fetch(origin + "/api/ai/session")).json();
  const call = (p, body, headers = {}) => fetch(origin + p, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Slate-Token": requestToken, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { origin, call, store, requestToken };
}

test("AI endpoints reject other websites and requests without the page token", async (t) => {
  const { origin, call } = await server(t);
  assert.equal((await fetch(origin + "/api/ai/providers")).status, 403);
  assert.equal((await call("/api/ai/providers", undefined, { Origin: "https://evil.test" })).status, 403);
  // A rebinding attack arrives with the attacker's host name.
  const status = await new Promise((resolve, reject) => {
    const req = http.get(origin + "/api/ai/session", { headers: { Host: "evil.test" } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
  });
  assert.equal(status, 403);
  assert.equal((await call("/api/ai/providers")).status, 200);
});

test("keys are saved outside the workspace and never sent back to the page", async (t) => {
  const { call, store } = await server(t);
  const saved = await (await call("/api/ai/providers/save", { type: "mistral", apiKey: "secret-mistral-key" })).json();
  assert.deepEqual(saved.account, { id: "mistral", type: "mistral", name: "Mistral", baseUrl: "", hasKey: true, keyHint: "…-key" });
  assert.equal(store.value.accounts[0].apiKey, "secret-mistral-key");
  const list = await (await call("/api/ai/providers")).text();
  assert.equal(list.includes("secret-mistral-key"), false);
  const providers = JSON.parse(list).providers.map((p) => p.type).sort();
  assert.deepEqual(providers, ["anthropic", "chatgpt", "gemini", "mistral", "ollama", "openai-compatible", "qwen"]);
  // Saving again without a key keeps the stored one; one key per provider.
  await call("/api/ai/providers/save", { type: "mistral" });
  assert.equal(store.value.accounts.filter((a) => a.type === "mistral").length, 1);
  assert.equal(store.value.accounts[0].apiKey, "secret-mistral-key");
});

test("custom OpenAI-compatible services: several allowed, https only, key tied to its address", async (t) => {
  const { call, store } = await server(t);
  const a = (await (await call("/api/ai/providers/save", { type: "openai-compatible", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "g1" })).json()).account;
  await call("/api/ai/providers/save", { type: "openai-compatible", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "o1" });
  assert.equal(store.value.accounts.length, 2);
  const insecure = await call("/api/ai/providers/save", { type: "openai-compatible", name: "Bad", baseUrl: "http://example.com/v1", apiKey: "x" });
  assert.equal(insecure.status, 400);
  const moved = await call("/api/ai/providers/save", { id: a.id, type: "openai-compatible", name: "Groq", baseUrl: "https://elsewhere.example/v1" });
  assert.match((await moved.json()).error, /API key again/);
  await call("/api/ai/providers/remove", { id: a.id });
  assert.deepEqual(store.value.accounts.map((x) => x.name), ["OpenRouter"]);
});

test("Qwen defaults to the Singapore address, and a key only follows a new region when pasted again", async (t) => {
  const { call, store } = await server(t);
  const saved = (await (await call("/api/ai/providers/save", { type: "qwen", apiKey: "sk-intl" })).json()).account;
  assert.equal(saved.baseUrl, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
  const moved = await call("/api/ai/providers/save", { type: "qwen", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" });
  assert.match((await moved.json()).error, /API key again/);
  await call("/api/ai/providers/save", { type: "qwen", baseUrl: "https://ws123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", apiKey: "sk-ws" });
  assert.deepEqual(store.value.accounts.map((a) => [a.id, a.baseUrl, a.apiKey]),
    [["qwen", "https://ws123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", "sk-ws"]]);
  const info = (await (await call("/api/ai/providers")).json()).providers.find((p) => p.type === "qwen");
  assert.equal(info.regions[0].name, "International (Singapore)");
});

test("checking tool calling makes one small real request", async (t) => {
  const { call } = await server(t);
  await call("/api/ai/providers/save", { type: "qwen", apiKey: "sk" });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let sent;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("dashscope")) return original(url, init);
    sent = JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_today","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
  };
  const result = await (await call("/api/ai/check-tools", { account: "qwen", model: "qwen-plus" })).json();
  assert.deepEqual(result, { tools: true });
  assert.equal(sent.tools[0].function.name, "get_today");
  assert.equal(sent.stream, true);
});

test("chat streams deltas then the finished turn, and errors carry retry timing", async (t) => {
  const { call } = await server(t);
  await call("/api/ai/providers/save", { type: "mistral", apiKey: "k" });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const realFetch = original;
  let mode = "ok";
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://api.mistral.ai")) return realFetch(url, init);
    if (mode === "limit") return new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  };
  const body = { account: "mistral", model: "mistral-small-latest", messages: [{ role: "user", content: "Hi" }] };
  const lines = (await (await call("/api/ai/chat", body)).text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ type: "delta", text: "Hello" }, { type: "done", text: "Hello", toolCalls: [] }]);
  mode = "limit";
  const failed = (await (await call("/api/ai/chat", body)).text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(failed.at(-1).code, "rate_limited");
  assert.equal(failed.at(-1).retryAfter, 30);
});

test("ChatGPT is offered only while its plan connection is active", async (t) => {
  const { call } = await server(t, { runtime: { status: async () => ({ planEnabled: false }) } });
  const res = await call("/api/ai/models?account=chatgpt");
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Connect ChatGPT/);
});

test("chat requests are checked before anything is sent", () => {
  const base = { account: "mistral", model: "m" };
  assert.throws(() => validateChat({ ...base, messages: [] }));
  assert.throws(() => validateChat({ ...base, messages: [{ role: "system", content: "x" }] }));
  assert.throws(() => validateChat({ ...base, messages: [{ role: "tool", toolCallId: "nope", name: "get_page", content: "x" }] }), /invalid message/);
  assert.throws(() => validateChat({ ...base, messages: [{ role: "user", content: "x".repeat(400001) }] }));
  assert.throws(() => validateChat({ ...base, messages: [{ role: "user", content: "hi" }], tools: [{ name: "Bad Name", description: "", parameters: {} }] }));
  const ok = validateChat({ ...base, messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_page", arguments: { id: "p" } }] },
    { role: "tool", toolCallId: "c1", name: "get_page", content: "{}" },
  ] });
  assert.equal(ok.messages.length, 3);
});

test("the keys file is private to this user", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "slate-ai-keys-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const accounts = new Accounts({ store: accountStore(dir) });
  await accounts.save({ type: "gemini", apiKey: "gem" }, await loadProviders());
  const file = path.join(dir, "providers.json");
  assert.equal(JSON.parse(await readFile(file, "utf8")).accounts[0].apiKey, "gem");
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
});
