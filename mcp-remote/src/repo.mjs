// The user's private Slate sync repository, read and written in exactly the
// format src/sync.ts uses (slate/workspace.json), so Slate merges the
// changes on its next sync. Attachments are never touched.
import { validateWorkspace } from "../../src/validation.mjs";
import { migrateWorkspace } from "../../src/toggle.mjs";
import { mergeWorkspaces } from "../../src/sync-merge.mjs";
import { runTool, applyChange } from "../../src/note-tools.mjs";

const API = "https://api.github.com/repos/";
const FILE = "slate/workspace.json";

export class RepoError extends Error {}
class Conflict extends Error {}

function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function fromBase64(text) {
  const bin = atob(text.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class SlateRepo {
  constructor({ token, repo, fetch = (...a) => globalThis.fetch(...a) }) {
    if (!token) throw new RepoError("The server isn't set up yet: the GITHUB_TOKEN secret is missing.");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new RepoError("The server isn't set up yet: set GITHUB_REPO to owner/name.");
    this.token = token;
    this.repo = repo;
    this.fetch = fetch;
    this.checked = 0;
  }
  async call(path, init = {}) {
    let res;
    try {
      res = await this.fetch(API + this.repo + path, {
        ...init,
        headers: {
          Authorization: "Bearer " + this.token,
          Accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "slate-mcp-remote",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new RepoError("Couldn't reach GitHub. Try again in a moment.");
    }
    if (res.status === 401) throw new RepoError("GitHub didn't accept the server's token. Replace the GITHUB_TOKEN secret.");
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new RepoError("GitHub's rate limit was reached. Try again later.");
    return res;
  }
  /** Like Slate's sync: refuse a public repository. Checked every few minutes. */
  async ensurePrivate(now = Date.now()) {
    if (now - this.checked < 300000) return;
    const res = await this.call("");
    if (res.status === 404) throw new RepoError("The sync repository wasn't found, or the token can't see it.");
    if (!res.ok) throw new RepoError("GitHub returned an error (" + res.status + ").");
    const info = await res.json();
    if (!info.private) throw new RepoError("The sync repository is public, so anyone could read the notes. Slate's server only works with a private repository.");
    if (info.permissions && !info.permissions.push) throw new RepoError("The token can read but not write to the sync repository.");
    this.checked = now;
  }
  async read() {
    const res = await this.call("/contents/" + FILE);
    if (res.status === 404) throw new RepoError("There are no synced notes yet. Turn on sync in Slate (Settings & backups → Sync between your devices) first.");
    if (!res.ok) throw new RepoError("Couldn't read the synced notes (" + res.status + ").");
    const meta = await res.json();
    let text;
    if (meta.content && meta.encoding === "base64") text = new TextDecoder().decode(fromBase64(meta.content));
    else {
      const raw = await this.call("/contents/" + FILE, { raw: true });
      if (!raw.ok) throw new RepoError("Couldn't download the synced notes.");
      text = await raw.text();
    }
    let data;
    try { data = validateWorkspace(JSON.parse(text)); }
    catch { throw new RepoError("The synced notes couldn't be read. Open Slate and sync to repair them."); }
    return { sha: String(meta.sha), data: migrateWorkspace({ ...data, study: data.study || { items: [], days: [] } }) };
  }
  async write(data, sha, message) {
    validateWorkspace(data);
    const res = await this.call("/contents/" + FILE, {
      method: "PUT",
      body: JSON.stringify({ message, content: toBase64(new TextEncoder().encode(JSON.stringify(data))), sha }),
    });
    if (res.status === 409 || res.status === 422) throw new Conflict();
    if (!res.ok) throw new RepoError("Couldn't save to the sync repository (" + res.status + ").");
    return (await res.json()).content.sha;
  }
}

/**
 * Run a Slate tool against the repository. Reads use the latest synced
 * notes. A write is applied to them and committed; if Slate synced in
 * between, the two are combined with Slate's own sync merge, so a page
 * changed in both places keeps both versions.
 */
export async function runRepoTool(repo, name, args, deps) {
  await repo.ensurePrivate();
  let { data: base, sha } = await repo.read();
  const { result, change } = runTool(name, args, { data: base, deps });
  if (!change) return result;
  let next = applyChange(base, change, deps).data;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await repo.write(next, sha, `Slate MCP: ${name}`);
      return { ...result, saved: true, note: "Saved to the sync repository. It appears in Slate after its next sync." +
        (change.kind === "update_page" ? " The previous version is kept in Page history." : "") };
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
      const latest = await repo.read();
      next = mergeWorkspaces(next, latest.data, { lastSync: 0, dirty: true, base }, deps.newId).data;
      base = latest.data;
      sha = latest.sha;
    }
  }
  throw new RepoError("Slate keeps syncing at the same moment. Try again in a few seconds.");
}
