import { randomBytes } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tools, validateToolCall, writeTools } from './mcp-tools.mjs';

// One local proxy shared by the MCP stdio process and Slate's Electron renderer.
export function createMcpBridge({ userData, confirm, send }) {
  const key = randomBytes(32).toString('hex');
  const tokenFile = path.join(userData, 'slate-mcp.json');
  const pending = new Map();
  let server;
  function result(id, response) {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    clearTimeout(job.timer);
    job.resolve(response);
  }
  async function start() {
    const http = await import('node:http');
    await mkdir(userData, { recursive: true });
    server = http.createServer(async (req, res) => {
      const reply = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      };
      if (req.method !== 'POST' || req.url !== '/invoke') return reply(404, { error: 'Not found' });
      if (req.headers.authorization !== 'Bearer ' + key) return reply(401, { error: 'Unauthorized' });
      try {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 30000) throw Error('Request too large');
        }
        const { name, arguments: args } = JSON.parse(raw);
        validateToolCall(name, args);
        if (writeTools.has(name) && !(await confirm(name, args))) return reply(403, { error: 'User declined the change in Slate' });
        const id = randomBytes(16).toString('hex');
        const outcome = await new Promise((resolve) => {
          const timer = setTimeout(() => result(id, { error: 'Slate did not respond' }), 20000);
          pending.set(id, { resolve, timer });
          send(id, name, args);
        });
        reply(outcome.error ? 409 : 200, outcome);
      } catch (err) { reply(400, { error: err.message || 'Request failed' }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await writeFile(tokenFile, JSON.stringify({ port, token: key }), { mode: 0o600 });
    return tokenFile;
  }
  async function close() {
    for (const id of pending.keys()) result(id, { error: 'Slate closed' });
    await unlink(tokenFile).catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
  }
  return { start, close, result };
}
