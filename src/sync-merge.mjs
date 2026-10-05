// Merges a workspace from another device into this one.
// Pure function so it can be tested in Node.

const KEEP_TOMBSTONES = 90 * 86400000;

function byId(list) {
  return new Map((list || []).map((x) => [x.id, x]));
}

function sameContent(a, b) {
  return (
    a.title === b.title &&
    JSON.stringify(a.content) === JSON.stringify(b.content)
  );
}

/**
 * local, remote: workspaces. state.lastSync: time of the last successful
 * sync on this device. state.dirty: this device changed since then.
 * newId: makes ids for conflict copies.
 * Returns { data, conflicts } where conflicts lists page titles that were
 * edited on both devices (the other device's version is kept as a copy).
 */
export function mergeWorkspaces(local, remote, state, newId, now = Date.now()) {
  const lastSync = state.lastSync || 0;
  const dirty = !!state.dirty;
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, at] of Object.entries(local.deleted || {}))
    deleted[id] = Math.max(at, deleted[id] || 0);
  for (const [id, at] of Object.entries(deleted))
    if (now - at > KEEP_TOMBSTONES) delete deleted[id];
  const gone = (x) => x && deleted[x.id] !== undefined;

  const conflicts = [];
  const localPages = byId(local.pages);
  const remotePages = byId(remote.pages);
  const pages = [];
  for (const [id, mine] of localPages) {
    if (gone(mine)) continue;
    const theirs = remotePages.get(id);
    if (!theirs) {
      pages.push(mine);
      continue;
    }
    const mineChanged = mine.updatedAt > lastSync;
    const theirsChanged = theirs.updatedAt > lastSync;
    if (mineChanged && theirsChanged && !sameContent(mine, theirs)) {
      pages.push(mine);
      pages.push({
        ...theirs,
        id: newId(),
        title: (theirs.title || "Untitled") + " (from other device)",
        favorite: false,
      });
      conflicts.push(mine.title || "Untitled");
    } else pages.push(theirs.updatedAt > mine.updatedAt ? theirs : mine);
  }
  for (const [id, theirs] of remotePages)
    if (!localPages.has(id) && !gone(theirs)) pages.push(theirs);
  const pageIds = new Set(pages.map((p) => p.id));
  // Fix parents that no longer exist, and break any loop a merge created,
  // without changing the objects we were given.
  const parent = new Map(
    pages.map((p) => [
      p.id,
      p.parentId && pageIds.has(p.parentId) ? p.parentId : null,
    ]),
  );
  for (const p of pages) {
    const seen = new Set([p.id]);
    let next = parent.get(p.id);
    while (next) {
      if (seen.has(next)) {
        parent.set(p.id, null);
        break;
      }
      seen.add(next);
      next = parent.get(next);
    }
  }
  for (let i = 0; i < pages.length; i++)
    if (pages[i].parentId !== parent.get(pages[i].id))
      pages[i] = { ...pages[i], parentId: parent.get(pages[i].id) };

  const union = (a, b) => {
    const mine = byId(a);
    const theirs = byId(b);
    const out = [];
    for (const [id, x] of mine)
      if (!gone(x)) out.push(dirty || !theirs.has(id) ? x : theirs.get(id));
    for (const [id, x] of theirs) if (!mine.has(id) && !gone(x)) out.push(x);
    return out;
  };
  const tasks = union(local.tasks, remote.tasks).map((t) =>
    t.pageId && !pageIds.has(t.pageId) ? { ...t, pageId: null } : t,
  );
  const cards = union(local.cards, remote.cards).map((c) =>
    c.pageId && !pageIds.has(c.pageId) ? { ...c, pageId: null } : c,
  );
  const attachments = union(local.attachments, remote.attachments).filter(
    (a) => pageIds.has(a.pageId),
  );
  const collections = union(local.collections, remote.collections);

  const items = new Map();
  for (const i of [
    ...((remote.study && remote.study.items) || []),
    ...((local.study && local.study.items) || []),
  ]) {
    const old = items.get(i.id);
    if (!old || i.last >= old.last) items.set(i.id, i);
  }
  const days = [
    ...new Set([
      ...((local.study && local.study.days) || []),
      ...((remote.study && remote.study.days) || []),
    ]),
  ]
    .sort()
    .slice(-400);

  return {
    data: {
      ...local,
      schema: 1,
      pages,
      tasks,
      cards,
      attachments,
      collections,
      study: {
        items: [...items.values()].filter(
          (i) => !i.pageId || pageIds.has(i.pageId),
        ),
        days,
      },
      deleted,
      settings: local.settings,
    },
    conflicts,
  };
}

function rebaseList(before, current, merged) {
  const was = new Map((before || []).map((x) => [x.id, x]));
  const now = new Map((current || []).map((x) => [x.id, x]));
  const out = (merged || [])
    .filter((x) => !(was.has(x.id) && !now.has(x.id)))
    .map((x) =>
      now.has(x.id) && now.get(x.id) !== was.get(x.id) ? now.get(x.id) : x,
    );
  const ids = new Set(out.map((x) => x.id));
  for (const x of current || []) if (!was.has(x.id) && !ids.has(x.id)) out.push(x);
  return out;
}

/**
 * The user kept editing while a sync was running. `before` is what was
 * synced, `merged` is the sync result, `current` is the workspace now.
 * Re-applies the edits made during the sync on top of the result.
 */
export function rebaseEdits(before, current, merged) {
  const out = { ...merged };
  for (const key of ["pages", "tasks", "cards", "attachments", "collections"])
    if (current[key] !== before[key])
      out[key] = rebaseList(before[key], current[key], merged[key]);
  if (current.study !== before.study) {
    const b = before.study || { items: [], days: [] };
    const c = current.study || { items: [], days: [] };
    const m = merged.study || { items: [], days: [] };
    out.study = {
      items: rebaseList(b.items, c.items, m.items),
      days: [...new Set([...m.days, ...c.days])].sort().slice(-400),
    };
  }
  if (current.deleted !== before.deleted)
    out.deleted = { ...(merged.deleted || {}), ...(current.deleted || {}) };
  out.settings = current.settings;
  return out;
}
