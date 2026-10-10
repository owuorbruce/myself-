import { getFile, getLocal, putFile, setLocal, normalize } from "./storage";
import { mergeWorkspaces, rebaseEdits } from "./sync-merge.mjs";
export { rebaseEdits };
import { validateWorkspace } from "./validation.mjs";
import { migrateWorkspace } from "./toggle.mjs";
import { uid, type Workspace } from "./types";

/** Sync keeps a copy of the workspace in a private GitHub repository. */
export type SyncConfig = { token: string; repo: string };
export type SyncState = { sha: string; lastSync: number; dirty: boolean };

const FOLDER = "slate";
const API = "https://api.github.com/repos/";

export const getConfig = () => getLocal<SyncConfig>("sync");
export const setConfig = (c: SyncConfig | undefined) => setLocal("sync", c);
export async function getState(): Promise<SyncState> {
  return (
    (await getLocal<SyncState>("syncState")) || {
      sha: "",
      lastSync: 0,
      dirty: true,
    }
  );
}
export const setState = (s: SyncState) => setLocal("syncState", s);

export const clearBase = () => setLocal("syncBase", undefined);

export class SyncError extends Error {}

async function request(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new SyncError(
      navigator.onLine
        ? "Couldn't reach GitHub. Try again in a moment."
        : "You're offline. Slate will sync when you're back online.",
    );
  }
}

async function call(
  c: SyncConfig,
  path: string,
  init: RequestInit & { raw?: boolean } = {},
) {
  const res = await request(API + c.repo + "/contents/" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + c.token,
      Accept: init.raw
        ? "application/vnd.github.raw+json"
        : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 401)
    throw new SyncError("GitHub didn't accept the token. Check or replace it.");
  if (res.status === 403)
    throw new SyncError(
      "The token can't write to that repository. Give it Contents: Read and write.",
    );
  return res;
}

function toBase64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function fromBase64(text: string) {
  const bin = atob(text.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Checks the token and repository, and that the repository is private. */
export async function testConfig(c: SyncConfig) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo))
    throw new SyncError("Write the repository as owner/name, like you/slate-notes.");
  const res = await request(API + c.repo, {
    headers: {
      Authorization: "Bearer " + c.token,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (res.status === 404)
    throw new SyncError(
      "Repository not found. Check the name, and that the token can access it.",
    );
  if (res.status === 401)
    throw new SyncError("GitHub didn't accept the token.");
  if (!res.ok) throw new SyncError("GitHub returned an error (" + res.status + ").");
  const repo = await res.json();
  if (!repo.private)
    throw new SyncError(
      "That repository is public, so anyone could read your notes. Use a private repository.",
    );
  if (repo.permissions && !repo.permissions.push)
    throw new SyncError("The token can read but not write to that repository.");
}

async function readRemote(c: SyncConfig) {
  const res = await call(c, `${FOLDER}/workspace.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError("Couldn't read from GitHub (" + res.status + ").");
  const meta = await res.json();
  let text: string;
  if (meta.content && meta.encoding === "base64")
    text = new TextDecoder().decode(fromBase64(meta.content));
  else {
    const raw = await call(c, `${FOLDER}/workspace.json`, { raw: true });
    if (!raw.ok) throw new SyncError("Couldn't download the synced workspace.");
    text = await raw.text();
  }
  const data = normalize(validateWorkspace(JSON.parse(text)) as Workspace);
  return { sha: String(meta.sha), data };
}

async function write(
  c: SyncConfig,
  path: string,
  base64: string,
  sha?: string,
) {
  return call(c, path, {
    method: "PUT",
    body: JSON.stringify({
      message: "Slate sync " + new Date().toISOString(),
      content: base64,
      ...(sha ? { sha } : {}),
    }),
  });
}

async function remoteFiles(c: SyncConfig) {
  const res = await call(c, `${FOLDER}/attachments`);
  if (res.status === 404) return new Map<string, number>();
  if (!res.ok) throw new SyncError("Couldn't list synced attachments.");
  const list = (await res.json()) as { name: string; size: number }[];
  return new Map(list.map((f) => [f.name, f.size]));
}

export type SyncResult = {
  data: Workspace;
  changed: boolean;
  conflicts: string[];
};

/**
 * Pull, merge and push. `local` is the workspace as it is now.
 * Returns the merged workspace; the caller applies it if `changed`.
 */
export async function syncNow(
  c: SyncConfig,
  local: Workspace,
  attempt = 0,
): Promise<SyncResult> {
  const started = Date.now();
  const state = await getState();
  const remote = await readRemote(c);
  let data = local;
  let conflicts: string[] = [];
  if (remote && remote.sha !== state.sha) {
    // Compare against the base in today's format, so turning Tap to Learn
    // blocks into toggles doesn't count as an edit on either device.
    const saved = await getLocal<Workspace>("syncBase");
    const base = saved && migrateWorkspace(saved);
    const merged = mergeWorkspaces(local, remote.data, { ...state, base }, uid);
    data = merged.data;
    conflicts = merged.conflicts;
  }
  const changed = data !== local;
  // Fetch attachment bytes this device doesn't have yet.
  for (const a of data.attachments) {
    const existing = await getFile(a.id);
    if (existing) {
      if (existing.size !== a.size) throw new SyncError(`Attachment ${a.name} has incomplete bytes. Restore it from a backup before syncing.`);
      continue;
    }
    const res = await call(c, `${FOLDER}/attachments/${a.id}`, { raw: true });
    if (!res.ok) throw new SyncError(`Couldn't download ${a.name} (${res.status}). Sync is incomplete; your local notes are safe.`);
    const blob = new Blob([await res.arrayBuffer()], { type: a.type });
    if (blob.size !== a.size) throw new SyncError(`Download of ${a.name} was incomplete. Try syncing again.`);
    await putFile(a.id, blob);
  }
  let sha = remote?.sha || "";
  if (!remote || state.dirty || changed || remote.sha !== state.sha) {
    // Upload new attachments before the workspace that refers to them.
    const have = await remoteFiles(c);
    for (const a of data.attachments) {
      if (have.has(a.id)) {
        if (have.get(a.id) !== a.size)
          throw new SyncError(`Synced attachment ${a.name} is incomplete. Restore it before syncing.`);
        continue;
      }
      const blob = await getFile(a.id);
      if (!blob || blob.size !== a.size) throw new SyncError(`Attachment ${a.name} is missing or incomplete. Restore it before syncing.`);
      const res = await write(
        c,
        `${FOLDER}/attachments/${a.id}`,
        toBase64(new Uint8Array(await blob.arrayBuffer())),
      );
      if (!res.ok)
        throw new SyncError(`Couldn't upload ${a.name} (${res.status}).`);
    }
    const body = toBase64(new TextEncoder().encode(JSON.stringify(data)));
    const res = await write(c, `${FOLDER}/workspace.json`, body, remote?.sha);
    if (res.status === 409 || res.status === 422) {
      // Another device synced in between. Start over once.
      if (attempt < 2) return syncNow(c, local, attempt + 1);
      throw new SyncError("Another device keeps syncing. Try again in a moment.");
    }
    if (!res.ok) throw new SyncError("Couldn't upload to GitHub (" + res.status + ").");
    sha = (await res.json()).content.sha;
  }
  await setLocal("syncBase", data);
  await setState({ sha, lastSync: started, dirty: false });
  return { data, changed: data !== local || attempt > 0, conflicts };
}

export async function markDirty() {
  const s = await getState();
  if (!s.dirty) await setState({ ...s, dirty: true });
}

export async function remoteExists(c: SyncConfig) {
  const res = await call(c, `${FOLDER}/workspace.json`);
  return res.ok;
}
