// Adds the pages of another Slate workspace (or a page pack) to this one,
// without replacing anything. Pure so it can be tested in Node.

function walk(node, fn) {
  if (!node || typeof node !== "object") return node;
  const next = fn(node);
  return next.content
    ? { ...next, content: next.content.map((c) => walk(c, fn)) }
    : next;
}

/**
 * current: this workspace. incoming: a validated workspace from a file.
 * Top-level incoming pages may carry `placeUnder`: the start of a page title
 * in this workspace to nest them under (for example "Lab 2 Tissues").
 * Returns the merged workspace, the old→new attachment ids, and the new
 * top-level page ids.
 */
export function mergePages(current, incoming, newId, now = Date.now()) {
  const ids = new Map();
  const id = (old) => {
    if (!ids.has(old)) ids.set(old, newId());
    return ids.get(old);
  };
  const live = current.pages.filter((p) => !p.trashed);
  const findPlace = (hint) => {
    if (!hint) return null;
    const h = String(hint).toLowerCase();
    const matches = live
      .filter((p) => (p.title || "").toLowerCase().startsWith(h))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return matches[0]?.id || null;
  };
  const fresh = (content) =>
    walk(content, (n) => {
      if (n.type === "pageLink" && n.attrs?.id)
        return { ...n, attrs: { ...n.attrs, id: id(n.attrs.id) } };
      if (["reveal", "blank", "labelImage"].includes(n.type))
        return { ...n, attrs: { ...n.attrs, id: newId() } };
      return n;
    });
  const incomingIds = new Set(incoming.pages.map((p) => p.id));
  const roots = [];
  const pages = incoming.pages
    .filter((p) => !p.trashed)
    .map((p) => {
      const { placeUnder, ...page } = p;
      const isRoot = !p.parentId || !incomingIds.has(p.parentId);
      const parentId = isRoot ? findPlace(placeUnder) : id(p.parentId);
      if (isRoot) roots.push(id(p.id));
      // Page links to pages outside the file keep pointing nowhere useful,
      // so they become plain labels.
      return {
        ...page,
        id: id(p.id),
        parentId,
        favorite: false,
        content: fresh(page.content),
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
    });
  const pageIds = new Set(pages.map((p) => p.id));
  for (const p of pages)
    p.content = walk(p.content, (n) =>
      n.type === "pageLink" && !pageIds.has(n.attrs?.id) &&
      !current.pages.some((c) => c.id === n.attrs?.id)
        ? { type: "text", text: String(n.attrs?.label || "link") }
        : n,
    );
  const onPage = (pageId) =>
    pageId && incomingIds.has(pageId) ? id(pageId) : null;
  const files = new Map();
  const attachments = incoming.attachments
    .filter((a) => incomingIds.has(a.pageId))
    .map((a) => {
      const next = newId();
      files.set(a.id, next);
      return { ...a, id: next, pageId: id(a.pageId) };
    });
  const tasks = incoming.tasks.map((t) => ({
    ...t,
    id: newId(),
    pageId: onPage(t.pageId),
  }));
  const cards = incoming.cards.map((c) => ({
    ...c,
    id: newId(),
    pageId: onPage(c.pageId),
  }));
  const collections = incoming.collections.map((c) => ({
    ...c,
    id: newId(),
    rows: c.rows.map((r) => ({ ...r, id: newId() })),
  }));
  return {
    data: {
      ...current,
      pages: [...current.pages, ...pages],
      tasks: [...current.tasks, ...tasks],
      cards: [...current.cards, ...cards],
      attachments: [...current.attachments, ...attachments],
      collections: [...current.collections, ...collections],
    },
    files,
    roots,
    placed: pages.filter((p) => roots.includes(p.id) && p.parentId).length,
  };
}
