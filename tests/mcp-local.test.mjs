import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalServer } from "../server/local-server.mjs";
import { createMcpBridge } from "../desktop/mcp-bridge.mjs";

const TOKEN = "t".repeat(43);

async function serve(t, bridge) {
  const dir = await mkdtemp(path.join(tmpdir(), "slate-mcp-"));
  const local = createLocalServer({ root: dir, mcp: bridge });
  const origin = await local.listen(0);
  t.after(async () => { await local.close(); await rm(dir, { recursive: true, force: true }); });
  return origin;
}
function fakeBridge(overrides = {}) {
  const calls = [], log = [];
  return {
    calls, log,
    config: async () => ({ enabled: true, token: TOKEN }),
    record: (name) => log.push(name),
    call: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_page" && args.id === "missing") throw new Error("No page with that id.");
      return { name, args };
    },
    ...overrides,
  };
}
async function connect(origin, token = TOKEN) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token } } }));
  return client;
}
const raw = (origin, headers = {}, port = new URL(origin).port) => new Promise((resolve, reject) => {
  const req = http.request(origin + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers } }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => resolve({ status: res.statusCode, body }));
  });
  req.on("error", reject);
  req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
});

test("an MCP client lists Slate's tools and calls them through the Slate window", async (t) => {
  const bridge = fakeBridge();
  const client = await connect(await serve(t, bridge));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name), ["search_pages", "list_pages", "get_page", "create_page", "update_page", "list_tasks", "create_task", "list_flashcards"]);
  assert.equal(tools.find((x) => x.name === "get_page").annotations.readOnlyHint, true);
  assert.equal(tools.find((x) => x.name === "update_page").annotations.destructiveHint, false);
  assert.equal(tools.some((x) => /delete/.test(x.name)), false);
  const result = await client.callTool({ name: "search_pages", arguments: { query: "bones" } });
  assert.deepEqual(JSON.parse(result.content[0].text), { name: "search_pages", args: { query: "bones" } });
  const failed = await client.callTool({ name: "get_page", arguments: { id: "missing" } });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /No page/);
  assert.deepEqual(bridge.log, ["search_pages", "get_page"], "the log keeps tool names only");
});

test("web pages, other host names and missing tokens are refused", async (t) => {
  const origin = await serve(t, fakeBridge());
  assert.equal((await raw(origin, { Origin: "https://evil.test" })).status, 403);
  assert.equal((await raw(origin, { Origin: "http://localhost:4173", Authorization: "Bearer " + TOKEN })).status, 403, "even Slate's own page can't call it");
  assert.equal((await raw(origin, { Host: "evil.test:4173", Authorization: "Bearer " + TOKEN })).status, 403);
  const missing = await raw(origin);
  assert.equal(missing.status, 401);
  assert.equal((await raw(origin, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await raw(origin, { Authorization: "Bearer " + TOKEN })).status, 200);
});

test("off by default, and a clear message when only the browser launcher is running", async (t) => {
  const off = await serve(t, fakeBridge({ config: async () => ({ enabled: false, token: TOKEN }) }));
  const res = await raw(off, { Authorization: "Bearer " + TOKEN });
  assert.equal(res.status, 403);
  assert.match(res.body, /Connect an AI app/);
  const launcher = await serve(t, undefined);
  assert.match((await raw(launcher, { Authorization: "Bearer " + TOKEN })).body, /Open Slate first/);
});

test("the desktop bridge keeps its token private, starts off, and needs the window", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "slate-mcp-bridge-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const sent = [];
  const bridge = createMcpBridge({ folder, send: (r) => sent.push(r), timeout: 200 });
  const first = await bridge.config();
  assert.equal(first.enabled, false);
  assert.ok(first.token.length >= 43);
  await assert.rejects(bridge.set({ remoteUrl: "http://example.com" }), /https/);
  await bridge.set({ enabled: true, remoteUrl: "https://slate-mcp.example.workers.dev/" });
  const second = await bridge.regenerate();
  assert.notEqual(second.token, first.token);
  assert.equal(second.remoteUrl, "https://slate-mcp.example.workers.dev");
  await assert.rejects(bridge.call("list_pages", {}), /Open Slate first/);
  bridge.setReady(true);
  const answer = bridge.call("list_pages", {});
  bridge.result(sent[0].id, { value: { pages: [] } });
  assert.deepEqual(await answer, { pages: [] });
  const failing = bridge.call("get_page", { id: "x" });
  bridge.result(sent[1].id, { error: "No page with that id." });
  await assert.rejects(failing, /No page/);
  const slow = bridge.call("list_pages", {});
  await assert.rejects(slow, /too long/);
  const reloading = bridge.call("list_pages", {});
  bridge.setReady(false);
  await assert.rejects(reloading, /reloaded/);
  bridge.record("get_page");
  await new Promise((r) => setTimeout(r, 50));
  const saved = JSON.parse(await readFile(path.join(folder, "mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(saved.log.at(-1)).sort(), ["at", "tool"]);
});
