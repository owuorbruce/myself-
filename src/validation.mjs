const fail = () => {
  throw new Error("Invalid Slate backup. No existing data was changed.");
};
const str = (v) => typeof v === "string";
const num = (v) => Number.isFinite(v);
const bool = (v) => typeof v === "boolean";
const list = (v) => Array.isArray(v) && v.length < 100000;
const types = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "image",
  "callout",
  "pageLink",
]);
export function validDoc(doc, depth = 0) {
  if (!doc || typeof doc !== "object" || depth > 40 || !types.has(doc.type))
    return false;
  if (doc.text !== undefined && !str(doc.text)) return false;
  if (
    doc.marks &&
    (!list(doc.marks) ||
      !doc.marks.every((m) =>
        [
          "bold",
          "italic",
          "strike",
          "code",
          "link",
          "underline",
          "highlight",
        ].includes(m.type),
      ))
  )
    return false;
  if (
    doc.marks?.some(
      (m) =>
        m.type === "link" && !/^(https?:|mailto:)/i.test(m.attrs?.href || ""),
    )
  )
    return false;
  if (doc.attrs) {
    if (typeof doc.attrs !== "object") return false;
    if (
      doc.type === "image" &&
      !/^data:image\/(png|jpeg|gif|webp);base64,/.test(doc.attrs.src || "")
    )
      return false;
    if (doc.type === "heading" && ![1, 2, 3, 4, 5, 6].includes(doc.attrs.level))
      return false;
  }
  return (
    !doc.content ||
    (list(doc.content) && doc.content.every((n) => validDoc(n, depth + 1)))
  );
}
export function validateWorkspace(w) {
  if (
    !w ||
    w.schema !== 1 ||
    !["pages", "tasks", "cards", "attachments", "collections"].every((k) =>
      list(w[k]),
    )
  )
    fail();
  const ids = new Set();
  const unique = (id) => {
    if (!str(id) || !id || ids.has(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) fail();
    ids.add(id);
  };
  for (const p of w.pages) {
    unique(p.id);
    if (
      !str(p.title) ||
      !str(p.icon) ||
      !str(p.plainText) ||
      !list(p.tags) ||
      !p.tags.every(str) ||
      !bool(p.favorite) ||
      !bool(p.trashed) ||
      !num(p.createdAt) ||
      !num(p.updatedAt) ||
      !validDoc(p.content) ||
      p.content.type !== "doc" ||
      !list(p.versions) ||
      !p.versions.every((v) => num(v.at) && str(v.title) && validDoc(v.content))
    )
      fail();
  }
  const pages = new Map(w.pages.map((p) => [p.id, p]));
  for (const p of w.pages) {
    if (p.parentId !== null && !pages.has(p.parentId)) fail();
    const chain = new Set([p.id]);
    let next = p.parentId;
    while (next) {
      if (chain.has(next)) fail();
      chain.add(next);
      next = pages.get(next)?.parentId;
    }
  }
  for (const t of w.tasks) {
    unique(t.id);
    if (
      !str(t.text) ||
      !str(t.due) ||
      !bool(t.done) ||
      !str(t.priority) ||
      (t.pageId !== null && !pages.has(t.pageId))
    )
      fail();
  }
  for (const c of w.cards) {
    unique(c.id);
    if (
      !str(c.question) ||
      !str(c.answer) ||
      !num(c.due) ||
      !num(c.interval) ||
      (c.pageId !== null && !pages.has(c.pageId))
    )
      fail();
  }
  for (const a of w.attachments) {
    unique(a.id);
    if (
      !pages.has(a.pageId) ||
      !str(a.name) ||
      !str(a.type) ||
      !num(a.size) ||
      a.size < 0 ||
      !str(a.text)
    )
      fail();
  }
  for (const c of w.collections) {
    unique(c.id);
    if (
      !str(c.name) ||
      !["table", "board", "calendar", "list", "gallery"].includes(c.view) ||
      !list(c.fields) ||
      !list(c.rows)
    )
      fail();
    const fields = new Set();
    for (const f of c.fields) {
      if (
        !str(f.id) ||
        fields.has(f.id) ||
        !str(f.name) ||
        !["text", "number", "date", "checkbox", "select", "url"].includes(
          f.type,
        ) ||
        (f.options && (!list(f.options) || !f.options.every(str)))
      )
        fail();
      fields.add(f.id);
    }
    for (const r of c.rows) {
      unique(r.id);
      if (
        !r.values ||
        typeof r.values !== "object" ||
        Array.isArray(r.values) ||
        !Object.entries(r.values).every(
          ([k, v]) => fields.has(k) && (str(v) || bool(v)),
        )
      )
        fail();
    }
  }
  if (
    !w.settings ||
    !["light", "dark", "sepia"].includes(w.settings.theme) ||
    !["sans", "serif"].includes(w.settings.font) ||
    !bool(w.settings.wide)
  )
    fail();
  return w;
}
export function canMove(pages, id, parentId) {
  if (id === parentId) return false;
  let parent = pages.find((p) => p.id === parentId);
  const seen = new Set();
  while (parent) {
    if (parent.id === id || seen.has(parent.id)) return false;
    seen.add(parent.id);
    parent = pages.find((p) => p.id === parent.parentId);
  }
  return (
    parentId === null || pages.some((p) => p.id === parentId && !p.trashed)
  );
}
