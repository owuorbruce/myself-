// Toggle blocks (TipTap "details" nodes) and the move away from the old
// "reveal" (Tap to Learn) block. Pure so it runs in Node, the app and the
// remote MCP worker.

const textOf = (n) =>
  n.type === "text"
    ? n.text || ""
    : n.type === "blank"
      ? String(n.attrs?.answer || "").split("|")[0]
      : n.type === "pageLink"
        ? String(n.attrs?.label || "")
        : (n.content || []).map(textOf).join(n.type === "paragraph" || n.type === "heading" || n.type === "detailsSummary" ? "" : "\n");

/** A reveal block as a toggle. Keeps the id so Study history carries over. */
export function revealToToggle(node) {
  const question = String(node.attrs?.question || "").replace(/\s+/g, " ").trim();
  return {
    type: "details",
    attrs: { id: String(node.attrs?.id || "") },
    content: [
      { type: "detailsSummary", ...(question ? { content: [{ type: "text", text: question }] } : {}) },
      {
        type: "detailsContent",
        content: node.content?.length ? node.content.map(migrateContent) : [{ type: "paragraph" }],
      },
    ],
  };
}

/** Replace reveal blocks anywhere in a document. Returns the same object when there are none. */
export function migrateContent(node) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "reveal") return revealToToggle(node);
  if (!Array.isArray(node.content)) return node;
  let changed = false;
  const content = node.content.map((c) => {
    const next = migrateContent(c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, content } : node;
}

/** Migrate every page and snapshot. Unchanged pages keep their identity. */
export function migrateWorkspace(data) {
  if (!data || !Array.isArray(data.pages)) return data;
  let changed = false;
  const pages = data.pages.map((p) => {
    const content = migrateContent(p.content);
    let versionsChanged = false;
    const versions = Array.isArray(p.versions)
      ? p.versions.map((v) => {
          const c = migrateContent(v.content);
          if (c === v.content) return v;
          versionsChanged = true;
          return { ...v, content: c };
        })
      : p.versions;
    if (content === p.content && !versionsChanged) return p;
    changed = true;
    return { ...p, content, ...(versionsChanged ? { versions } : {}) };
  });
  return changed ? { ...data, pages } : data;
}

/** Summary text, the content blocks, and the content's own text (outside nested toggles). */
export function toggleParts(node) {
  const summary = (node.content || []).find((c) => c.type === "detailsSummary");
  const body = (node.content || []).find((c) => c.type === "detailsContent");
  const blocks = body?.content || [];
  return {
    id: String(node.attrs?.id || ""),
    summary: summary ? textOf(summary).replace(/\s+/g, " ").trim() : "",
    blocks,
    ownText: blocks.filter((b) => b.type !== "details").map(textOf).join("\n").trim(),
    answer: blocks.map(textOf).join("\n").trim(),
  };
}

/**
 * A toggle feeds Study when it has a summary and some text of its own.
 * Toggles that only hold other toggles act like sections.
 */
export function studyToggle(node) {
  if (node?.type === "reveal") node = revealToToggle(node);
  if (node?.type !== "details") return null;
  const parts = toggleParts(node);
  return parts.id && parts.summary && parts.ownText ? parts : null;
}
