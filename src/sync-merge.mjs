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
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, at] of Object.entries(local.deleted || {}))
    deleted[id] = Math.max(at, deleted[id] || 0);
  const restored = { ...(remote.restored || {}) };
  for (const [id, at] of Object.entries(local.restored || {}))
    restored[id] = Math.max(at, restored[id] || 0);
  for (const [id, at] of Object.entries(restored)) {
    if (at > (deleted[id] || 0)) delete deleted[id];
    if (now - at > KEEP_TOMBSTONES) delete restored[id];
  }
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
    const original = state.base?.pages?.find((p) => p.id === id);
    const mineChanged = original ? !sameContent(mine, original) : mine.updatedAt > lastSync;
    const theirsChanged = original ? !sameContent(theirs, original) : theirs.updatedAt > lastSync;
    if (mineChanged && theirsChanged && !sameContent(mine, theirs)) {
      pages.push(mine);
      pages.push({
        ...theirs,
        id: newId(),
        title: (theirs.title || "Untitled") + " (from other device)",
        favorite: false,
      });
      conflicts.push(mine.title || "Untitled");
    } else if (original && mineChanged !== theirsChanged) {
      pages.push(theirsChanged ? theirs : mine);
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

  // Compare each field with the last successful sync, independently of
  // unrelated edits elsewhere in the workspace. Without a baseline, retain
  // both versions of a disagreement instead of guessing which is newer.
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeValue(mine, theirs, base, conflict) {
    if (equal(mine, theirs)) return mine;
    if (equal(mine, base)) return theirs;
    if (equal(theirs, base)) return mine;
    if (mine === undefined || theirs === undefined) {
      // An edit made concurrently with removal is kept for recovery.
      return mine === undefined ? theirs : mine;
    }
    if (Array.isArray(mine) && Array.isArray(theirs)) {
      if ([...mine, ...theirs].every((x) => x && typeof x === "object" && x.id)) {
        const m = byId(mine), t = byId(theirs), b = byId(base);
        return [...new Set([...m.keys(), ...t.keys()])]
          .map((id) => mergeValue(m.get(id), t.get(id), b.get(id), conflict))
          .filter((x) => x !== undefined);
      }
      return [...new Set([...mine, ...theirs])];
    }
    if (mine && theirs && typeof mine === "object" && typeof theirs === "object") {
      const out = {};
      for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
        const value = mergeValue(mine[key], theirs[key], base?.[key], conflict);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    conflict.value = true;
    return mine;
  }
  const union = (key) => {
    const mine = byId(local[key]), theirs = byId(remote[key]);
    const base = byId(state.base?.[key]);
    const out = [];
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
      const x = mine.get(id), y = theirs.get(id);
      if (gone(x || y)) continue;
      const conflict = { value: false };
      const value = mergeValue(x, y, base.get(id), conflict);
      if (value === undefined) continue;
      out.push(value);
      if (conflict.value && x && y) {
        if (key === "attachments")
          throw new Error(`Attachment ${x.name} differs between devices. Resolve it from a backup before syncing.`);
        const copy = { ...y, id: newId() };
        if (key === "collections") {
          copy.name += " (from other device)";
          // Row ids are unique across the workspace, including copies.
          copy.rows = y.rows.map((row) => ({ ...row, id: newId() }));
        } else if (key === "tasks") copy.text += " (from other device)";
        else if (key === "cards") copy.question += " (from other device)";
        out.push(copy);
        conflicts.push(x.name || x.text || x.question || "Record");
      }
    }
    return out;
  };
  const tasks = union("tasks").map((t) =>
    t.pageId && !pageIds.has(t.pageId) ? { ...t, pageId: null } : t,
  );
  const cards = union("cards").map((c) =>
    c.pageId && !pageIds.has(c.pageId) ? { ...c, pageId: null } : c,
  );
  const attachments = union("attachments").filter((a) => pageIds.has(a.pageId));
  const collections = union("collections").map((c) => ({ ...c }));
  // Keep a removed field if the other device concurrently edited its values.
  for (const c of collections) {
    const fields = new Map(c.fields.map((f) => [f.id, f]));
    const source = [...(local.collections.find((x) => x.id === c.id)?.fields || []),
      ...(remote.collections.find((x) => x.id === c.id)?.fields || [])];
    for (const row of c.rows) for (const id of Object.keys(row.values)) {
      const field = source.find((f) => f.id === id);
      if (!fields.has(id) && field) fields.set(id, field);
    }
    c.fields = [...fields.values()];
  }

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
      restored,
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
  if (current.restored !== before.restored)
    out.restored = { ...(merged.restored || {}), ...(current.restored || {}) };
  out.settings = current.settings;
  return out;
}


/** Backup restore is an explicit local replacement. Queue removed ids for sync. */
export function prepareRestore(previous, restored, now = Date.now()) {
  const deleted = { ...(previous.deleted || {}), ...(restored.deleted || {}) };
  const recovered = { ...(previous.restored || {}), ...(restored.restored || {}) };
  for (const key of ["pages", "tasks", "cards", "attachments", "collections"]) {
    const ids = new Set(restored[key].map((x) => x.id));
    for (const old of previous[key]) if (!ids.has(old.id)) deleted[old.id] = now;
    for (const id of ids) {
      delete deleted[id];
      recovered[id] = now;
    }
  }
  return { ...restored, deleted, restored: recovered,
    pages: restored.pages.map((p) => ({ ...p, updatedAt: now })),
  };
}
