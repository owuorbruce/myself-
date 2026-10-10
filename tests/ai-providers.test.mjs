import test from "node:test";
import assert from "node:assert/strict";
import mistral from "../server/ai/providers/mistral.mjs";
import gemini, { geminiSchema } from "../server/ai/providers/gemini.mjs";
import anthropic from "../server/ai/providers/anthropic.mjs";
import ollama from "../server/ai/providers/ollama.mjs";
import compatible, { checkBaseUrl } from "../server/ai/providers/openai-compatible.mjs";
import chatgpt from "../server/ai/providers/chatgpt.mjs";
import qwen, { qwenTools } from "../server/ai/providers/qwen.mjs";
import { retryAfterSeconds } from "../server/ai/http.mjs";

const original = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = original; });
const sse = (events) => new Response(events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""));
const ndjson = (items) => new Response(items.map((x) => JSON.stringify(x) + "\n").join(""));
function capture(reply) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return typeof reply === "function" ? reply(String(url), init) : reply;
  };
  return calls;
}
const tool = { name: "get_page", description: "Read a page", parameters: { type: "object", properties: { id: { type: "string", maxLength: 100 } }, required: ["id"], additionalProperties: false } };
const history = [
  { role: "user", content: "Read my bones page" },
  { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "get_page", arguments: { id: "p1" } }] },
  { role: "tool", toolCallId: "call-1", name: "get_page", content: "{\"title\":\"Bones\"}" },
];
const run = (provider, account, extra = {}) => {
  let streamed = "";
  return provider.stream(account, { model: "m", system: "Be brief.", messages: history, tools: [tool], signal: new AbortController().signal, onText: (t) => { streamed += t; }, ...extra })
    .then((result) => ({ ...result, streamed }));
};

test("Mistral streams text and tool calls, with ids it accepts", async () => {
  const calls = capture(sse([
    { choices: [{ delta: { content: "Hi " } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "abcABC123", function: { name: "get_page", arguments: "{\"id\":" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"p2\"}" } }] }, finish_reason: "tool_calls" }] },
    "[DONE]",
  ]));
  const result = await run(mistral, { id: "mistral", type: "mistral", apiKey: "mk-1" });
  assert.equal(result.text, "Hi ");
  assert.equal(result.streamed, "Hi ");
  assert.deepEqual(result.toolCalls, [{ id: "abcABC123", name: "get_page", arguments: { id: "p2" } }]);
  const [call] = calls;
  assert.equal(call.url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(call.init.headers.Authorization, "Bearer mk-1");
  assert.equal(call.init.redirect, "error");
  const sent = call.body.messages;
  assert.equal(sent[0].role, "system");
  assert.match(sent[2].tool_calls[0].id, /^[a-zA-Z0-9]{9}$/);
  assert.equal(sent[3].tool_call_id, sent[2].tool_calls[0].id);
  assert.equal(call.body.tools[0].function.name, "get_page");
});

test("an OpenAI-compatible service only gets the key at its own address", async () => {
  const calls = capture(Response.json({ data: [{ id: "llama-3", supported_parameters: ["tools"] }, { id: "text-embedding-3" }, { id: "plain" }] }));
  const models = await compatible.listModels({ id: "custom-1", type: "openai-compatible", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "gk" }, {});
  assert.deepEqual(models, [{ id: "llama-3", name: "llama-3", tools: true }, { id: "plain", name: "plain", tools: null }]);
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/models");
  assert.equal(calls[0].init.redirect, "error");
  assert.throws(() => checkBaseUrl("http://example.com/v1"), /https/);
  assert.throws(() => checkBaseUrl("https://user:pw@example.com/v1"));
  assert.equal(checkBaseUrl("http://localhost:1234/v1/"), "http://localhost:1234/v1");
});

test("GitHub Models lists models from its catalog", async () => {
  const calls = capture(Response.json([{ id: "openai/gpt-4.1", name: "GPT-4.1", capabilities: ["streaming", "tool-calling"] }]));
  const models = await compatible.listModels({ type: "openai-compatible", name: "GitHub Models", baseUrl: "https://models.github.ai/inference", apiKey: "ghp" }, {});
  assert.equal(calls[0].url, "https://models.github.ai/catalog/models");
  assert.deepEqual(models, [{ id: "openai/gpt-4.1", name: "GPT-4.1", tools: true }]);
});

test("Gemini gets schemas it accepts, and its own turns are replayed with their signatures", async () => {
  assert.deepEqual(geminiSchema(tool.parameters), { type: "object", properties: { id: { type: "string" } }, required: ["id"] });
  const calls = capture(sse([
    { candidates: [{ content: { parts: [{ text: "Looking" }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "get_page", args: { id: "p3" } }, thoughtSignature: "sig" }] }, finishReason: "STOP" }] },
  ]));
  const native = { type: "gemini", parts: [{ functionCall: { name: "get_page", args: { id: "p1" } }, thoughtSignature: "earlier" }] };
  const messages = [history[0], { ...history[1], native }, history[2]];
  const result = await run(gemini, { type: "gemini", apiKey: "gk" }, { model: "gemini-2.5-flash", messages });
  assert.equal(result.text, "Looking");
  assert.equal(result.toolCalls[0].name, "get_page");
  assert.equal(result.native.parts[1].thoughtSignature, "sig");
  const body = calls[0].body;
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
  assert.equal(calls[0].init.headers["x-goog-api-key"], "gk");
  assert.equal(body.contents[1].parts[0].thoughtSignature, "earlier");
  assert.equal(body.contents[2].parts[0].functionResponse.name, "get_page");
  assert.equal(body.systemInstruction.parts[0].text, "Be brief.");
});

test("Claude streams text and assembles tool input", async () => {
  const calls = capture(sse([
    { type: "message_start" },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sure." } },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "get_page", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"id\":\"p9\"}" } },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ]));
  const result = await run(anthropic, { type: "anthropic", apiKey: "ak" });
  assert.equal(result.text, "Sure.");
  assert.deepEqual(result.toolCalls, [{ id: "toolu_1", name: "get_page", arguments: { id: "p9" } }]);
  assert.equal(calls[0].init.headers["x-api-key"], "ak");
  const msgs = calls[0].body.messages;
  assert.equal(msgs[1].content[0].type, "tool_use");
  assert.equal(msgs[2].content[0].type, "tool_result");
  assert.equal(calls[0].body.system, "Be brief.");
  assert.equal(calls[0].body.tools[0].input_schema.type, "object");
});

test("Ollama streams from this computer without a key", async () => {
  const calls = capture(ndjson([
    { message: { content: "Local " } },
    { message: { content: "", tool_calls: [{ function: { name: "get_page", arguments: { id: "p1" } } }] } },
    { done: true },
  ]));
  const result = await run(ollama, { type: "ollama", baseUrl: "http://localhost:11434" });
  assert.equal(result.text, "Local ");
  assert.equal(result.toolCalls[0].arguments.id, "p1");
  assert.equal(calls[0].url, "http://localhost:11434/api/chat");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].body.messages.at(-1).tool_name, "get_page");
});

test("Ollama not running gives a clear message", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(ollama.listModels({ type: "ollama" }, {}), /isn't running/);
});

test("ChatGPT sends tools in a namespace and reads function calls back", async () => {
  let sent;
  const runtime = {
    models: async () => [{ id: "m", name: "Model" }],
    api: async (endpoint, init) => {
      sent = { endpoint, body: JSON.parse(init.body) };
      return sse([
        { type: "response.output_text.delta", delta: "Checking" },
        { type: "response.output_item.done", item: { type: "function_call", call_id: "c9", name: "get_page", namespace: "slate", arguments: "{\"id\":\"p4\"}" } },
        { type: "response.completed", response: { status: "completed" } },
      ]);
    },
  };
  const result = await run(chatgpt, { type: "chatgpt", runtime });
  assert.equal(result.text, "Checking");
  assert.deepEqual(result.toolCalls, [{ id: "c9", name: "get_page", arguments: { id: "p4" } }]);
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.tools[0].type, "namespace");
  assert.equal(sent.body.tools[0].tools[0].name, "get_page");
  const items = sent.body.input;
  assert.equal(items[1].type, "function_call");
  assert.equal(items[1].namespace, "slate");
  assert.equal(items[2].type, "function_call_output");
});

test("Qwen lists chat models from its region and marks documented tool support", async () => {
  const calls = capture(Response.json({ data: [{ id: "qwen-plus" }, { id: "qwen3.6-flash" }, { id: "qwen-mt-turbo" }, { id: "qwen3-asr-flash" }, { id: "text-embedding-v4" }, { id: "someone-else" }] }));
  const models = await qwen.listModels({ type: "qwen", apiKey: "sk-q", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" }, {});
  assert.equal(calls[0].url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-q");
  assert.deepEqual(models.map((m) => [m.id, m.tools]), [["qwen-mt-turbo", false], ["qwen-plus", true], ["qwen3.6-flash", true], ["someone-else", null]]);
  assert.equal(qwenTools("qwen3-coder-plus"), true);
  assert.equal(qwenTools("qwen2.5-72b-instruct"), true);
});

test("Qwen streams tool calls whose later chunks have an empty id", async () => {
  capture(sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_8f08", type: "function", function: { name: "get_page", arguments: "{\"id\":" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "", type: "function", function: { arguments: " \"p1\"}" } }] }, finish_reason: "tool_calls" }] },
    "[DONE]",
  ]));
  const result = await run(qwen, { type: "qwen", apiKey: "k", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" });
  assert.deepEqual(result.toolCalls, [{ id: "call_8f08", name: "get_page", arguments: { id: "p1" } }]);
});

test("a rejected Qwen key says why, which region it was sent to, and never echoes the key", async () => {
  globalThis.fetch = async () => Response.json({ error: { message: "Incorrect API key provided: sk-abc123def456. ", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 });
  const account = { type: "qwen", apiKey: "sk-abc123def456", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" };
  await assert.rejects(qwen.listModels(account, {}), (e) =>
    e.code === "unauthorized" && /Incorrect API key/.test(e.message) && /International \(Singapore\)/.test(e.message) &&
    /region they were created in/.test(e.message) && !e.message.includes("abc123def456"));
  await assert.rejects(run(qwen, account), (e) => /International \(Singapore\)/.test(e.message));
  await assert.rejects(qwen.listModels({ ...account, apiKey: "LTAI5tExample" }, {}), /AccessKey, not a Model Studio API key/);
  assert.match(qwen.checkKey("LTAI5tExample"), /AccessKey ID/);
  assert.equal(qwen.checkKey("sk-abc"), "");
});

test("a 403 keeps the provider's reason, since it often isn't the key itself", async () => {
  globalThis.fetch = async () => Response.json({ code: "AccessDenied.Unpurchased", message: "Access to model denied. Please make sure you are eligible for using the model." }, { status: 403 });
  await assert.rejects(run(mistral, { type: "mistral", apiKey: "k" }), (e) => e.status === 403 && /Access to model denied/.test(e.message));
});

test("rate limits are reported once with when to try again", async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return new Response(JSON.stringify({ message: "Too many" }), { status: 429, headers: { "retry-after": "42" } }); };
  await assert.rejects(run(mistral, { type: "mistral", apiKey: "k" }), (e) => e.code === "rate_limited" && e.retryAfter === 42 && /42 seconds/.test(e.message));
  assert.equal(count, 1, "no automatic retry");
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "120s" }] } }), { status: 429 });
  await assert.rejects(run(gemini, { type: "gemini", apiKey: "k" }), (e) => e.retryAfter === 120 && /2 minutes/.test(e.message));
  assert.equal(retryAfterSeconds(new Date(Date.now() + 30000).toUTCString()) >= 29, true);
});

test("a stream that ends early is not an answer", async () => {
  capture(new Response("data: {\"choices\":[{\"delta\":{}}]}\n\n"));
  await assert.rejects(run(mistral, { type: "mistral", apiKey: "k" }), /ended before/);
});
