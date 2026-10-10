// Connects the local /mcp endpoint to the Slate window. Settings (on/off,
// token, the remote server's address) and the call log live in the app's
// own profile folder, outside the workspace and backups.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const newToken = () => randomBytes(32).toString('base64url');

export function createMcpBridge({ folder, send, timeout = 30000 }) {
  const file = path.join(folder, 'mcp.json');
  let state, ready = false, writing = Promise.resolve();
  const pending = new Map();
  async function load() {
    if (state) return state;
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch { state = null; }
    if (!state || typeof state.token !== 'string' || state.token.length < 32)
      state = { enabled: false, token: newToken(), remoteUrl: '', log: [] };
    state.log = Array.isArray(state.log) ? state.log.slice(-50) : [];
    return state;
  }
  function save() {
    writing = writing.then(async () => {
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    }).catch(() => {});
    return writing;
  }
  const view = (s) => ({ enabled: s.enabled, token: s.token, remoteUrl: s.remoteUrl, log: s.log, ready });
  return {
    async config() { return view(await load()); },
    async set(patch) {
      const s = await load();
      if (typeof patch?.enabled === 'boolean') s.enabled = patch.enabled;
      if (typeof patch?.remoteUrl === 'string') {
        const value = patch.remoteUrl.trim();
        if (value) {
          const url = new URL(value);
          if (url.protocol !== 'https:' || url.username || url.password) throw Error('The remote server address must start with https://');
          s.remoteUrl = url.href.replace(/\/+$/, '');
        } else s.remoteUrl = '';
      }
      await save();
      return view(s);
    },
    async regenerate() {
      const s = await load();
      s.token = newToken();
      await save();
      return view(s);
    },
    record(tool) {
      if (!state) return;
      state.log = [...state.log, { tool: String(tool).slice(0, 64), at: Date.now() }].slice(-50);
      void save();
    },
    /** The window says it can take calls (or can't, while it reloads). */
    setReady(value) {
      ready = value;
      if (!value) for (const [id, job] of pending) { clearTimeout(job.timer); job.reject(Error('Slate reloaded before finishing. Try again.')); pending.delete(id); }
    },
    call(name, args) {
      if (!ready) return Promise.reject(Error('Open Slate first: the Slate window needs to be open and finished loading.'));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error('Slate took too long to answer. Make sure it is open and try again.')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        send({ id, name, args });
      });
    },
    result(id, outcome) {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      if (outcome && typeof outcome.error === 'string') job.reject(Error(outcome.error));
      else job.resolve(outcome?.value ?? null);
    },
  };
}
