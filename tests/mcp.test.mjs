import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMcpBridge } from '../server/mcp-bridge.mjs';
import { tools, validateToolCall } from '../server/mcp-tools.mjs';

test('MCP exposes only safe note operations and rejects extra parameters', () => {
  assert.deepEqual(tools.map(x => x.name), ['list_notes', 'search_notes', 'get_note', 'create_note', 'append_to_note']);
  assert.throws(() => validateToolCall('delete_note', {}));
  assert.throws(() => validateToolCall('get_note', { id: 'a', secret: 'b' }));
  assert.throws(() => validateToolCall('append_to_note', { id: 'a', text: 'hello' }));
  assert.doesNotThrow(() => validateToolCall('append_to_note', { id: 'a', text: 'hello', expected_updated_at: 1 }));
});

test('loopback MCP bridge requires bearer authentication and user consent for writes', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slate-mcp-'));
  let approve = false, sent = [];
  const bridge = createMcpBridge({
    userData: dir,
    confirm: async () => approve,
    send: (id, name, args) => {
      sent.push({ name, args });
      queueMicrotask(() => bridge.result(id, { value: [{ id: 'note1' }] }));
    }
  });
  await bridge.start();
  const details = JSON.parse(await readFile(path.join(dir, 'slate-mcp.json'), 'utf8'));
  const url = 'http://127.0.0.1:' + details.port + '/invoke';
  t.after(async () => { await bridge.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (body, auth) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + details.token } : {}) }, body: JSON.stringify(body) });
  assert.equal((await request({ name: 'list_notes', arguments: {} }, false)).status, 401);
  assert.equal((await request({ name: 'create_note', arguments: { title: 'Test' } }, true)).status, 403);
  assert.equal(sent.length, 0);
  approve = true;
  const ok = await request({ name: 'create_note', arguments: { title: 'Test' } }, true);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).value, [{ id: 'note1' }]);
  assert.equal(sent[0].name, 'create_note');
});
