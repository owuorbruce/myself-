#!/usr/bin/env node
// Local MCP stdio adapter. Start Slate desktop before connecting.
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tools, validateToolCall } from './mcp-tools.mjs';
let buffer = Buffer.alloc(0);
const config = process.env.SLATE_MCP_CONFIG ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Slate', 'slate-mcp.json');
function respond(id, result, error) {
  if (id === undefined || id === null) return;
  const data = { jsonrpc: '2.0', id, ...(error ? { error: { code: -32603, message: error } } : { result }) };
  process.stdout.write(JSON.stringify(data) + '\n');
}
async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.method === 'notifications/initialized' || msg.method?.startsWith('notifications/')) return;
  if (msg.method === 'initialize') return respond(msg.id, {
    protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'slate-local', version: '1.0.0' }
  });
  if (msg.method === 'ping') return respond(msg.id, {});
  if (msg.method === 'tools/list') return respond(msg.id, { tools });
  if (msg.method !== 'tools/call') return respond(msg.id, undefined, 'Unsupported MCP request: ' + msg.method);
  try {
    const name = msg.params?.name, args = msg.params?.arguments || {};
    validateToolCall(name, args);
    const { port, token } = JSON.parse(await readFile(config, 'utf8'));
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[0-9a-f]{64}$/.test(token)) throw Error('Invalid Slate MCP connection details');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetch('http://127.0.0.1:' + port + '/invoke', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }), signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    const body = await response.json();
    respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(response.ok ? body : { error: body.error }) }], isError: !response.ok });
  } catch (err) {
    respond(msg.id, { content: [{ type: 'text', text: err.code === 'ENOENT' ? 'Open Slate desktop to enable the local MCP connection.' : String(err.message) }], isError: true });
  }
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length > 500000) process.exit(1);
  while (true) {
    const end = buffer.indexOf(10);
    if (end < 0) break;
    const line = buffer.subarray(0, end).toString('utf8').trim();
    buffer = buffer.subarray(end + 1);
    if (line) {
      try { void handle(JSON.parse(line)); } catch { /* ignore invalid JSON */ }
    }
  }
});
