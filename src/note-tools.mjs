// Note tools shared by the Ask AI chat, the local MCP server and the remote
// MCP worker. Pure functions over a workspace, so they run anywhere.
// Writes are returned as a "change" first; the caller decides when to apply
// it. There are no delete tools.
import { docToMarkdown, hasPictures } from "./doc-markdown.mjs";

const MAX_MARKDOWN = 200000;
const id = (description) => ({ type: "string", description, maxLength: 100 });

export const NOTE_TOOLS = [
  {
    name: "search_pages",
    description: "Search the user's Slate pages by title and text. Returns matching pages with id, title, path and a snippet.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Words to search for", maxLength: 200 } }, required: ["query"], additionalProperties: false },
    readOnly: true,
  },
  {
    name: "list_pages",
    description: "List pages in the page tree: the top-level pages, or the children of parent_id. Each has an id, title, path and how many child pages it has.",
    parameters: { type: "object", properties: { parent_id: id("List the children of this page. Leave out for top-level pages.") }, additionalProperties: false },
    readOnly: true,
  },
  {
    name: "get_page",
    description: "Read one page: its title and its content as Markdown. Toggles appear as <details><summary>…</summary>…</details>.",
    parameters: { type: "object", properties: { id: id("Page id") }, required: ["id"], additionalProperties: false },
    readOnly: true,
  },
  {
    name: "create_page",
    description: "Create a new page from Markdown, optionally inside another page. Supports headings, lists, checklists, quotes, code, tables, {{blank}} gaps and <details><summary>Summary</summary>Content</details> toggles.",
    parameters: { type: "object", properties: {
      title: { type: "string", description: "Page title", maxLength: 200 },
      markdown: { type: "string", description: "Page content as Markdown", maxLength: MAX_MARKDOWN },
      parent_id: id("Put the new page inside this page. Leave out for a top-level page."),
    }, required: ["title", "markdown"], additionalProperties: false },
    readOnly: false,
  },
  {
    name: "update_page",
    description: "Change a page's content. mode \"append\" adds the Markdown at the end; mode \"replace\" rewrites the whole page (read it first). A snapshot of the previous version is kept so the change can be undone.",
    parameters: { type: "object", properties: {
      id: id("Page id"),
      markdown: { type: "string", description: "Markdown to add or to use as the new content", maxLength: MAX_MARKDOWN },
      mode: { type: "string", enum: ["replace", "append"], description: "append adds to the end; replace rewrites the page" },
    }, required: ["id", "markdown", "mode"], additionalProperties: false },
    readOnly: false,
  },
  {
    name: "list_tasks",
    description: "List tasks with their due dates and the page they belong to.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["open", "done", "all"], description: "Which tasks to list (default open)" } }, additionalProperties: false },
    readOnly: true,
  },
  {
    name: "create_task",
    description: "Add a task, optionally with a due date (YYYY-MM-DD) and the page it belongs to.",
    parameters: { type: "object", properties: {
      title: { type: "string", description: "What needs doing", maxLength: 500 },
      due: { type: "string", description: "Due date as YYYY-MM-DD", maxLength: 10 },
      page_id: id("The page this task belongs to"),
    }, required: ["title"], additionalProperties: false },
    readOnly: false,
  },
  {
    name: "list_flashcards",
    description: "List study flashcards (question and answer), optionally only those from one page.",
    parameters: { type: "object", properties: { page_id: id("Only cards from this page") }, additionalProperties: false },
    readOnly: true,
  },
];

export class ToolError extends Error {}

/** Check arguments against a tool's schema. */
export function checkArgs(name, args) {
  const tool = NOTE_TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`There's no tool called ${name}.`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new ToolError("Tool arguments must be an object.");
  const { properties, required = [] } = tool.parameters;
  for (const key of required) if (args[key] === undefined || args[key] === null) throw new ToolError(`Missing ${key}.`);
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (!spec) throw new ToolError(`Unexpected argument ${key}.`);
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") throw new ToolError(`${key} must be text.`);
    if (spec.maxLength && value.length > spec.maxLength) throw new ToolError(`${key} is too long.`);
    if (spec.enum && !spec.enum.includes(value)) throw new ToolError(`${key} must be one of ${spec.enum.join(", ")}.`);
    out[key] = value;
  }
  return out;
}

const live = (data) => data.pages.filter((p) => !p.trashed);

export function pagePath(data, pageId) {
  const byId = new Map(data.pages.map((p) => [p.id, p]));
  const names = [];
  let p = byId.get(pageId);
  for (let i = 0; p && i < 50; i++) {
    names.unshift(p.title || "Untitled");
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return names.join(" / ");
}

/** scope: a Set of page ids the caller may read, or null for every page. */
function visible(data, scope) {
  return live(data).filter((p) => !scope || scope.has(p.id));
}
function findPage(data, pageId, scope) {
  const page = live(data).find((p) => p.id === pageId);
  if (!page) throw new ToolError("No page with that id. Use search_pages or list_pages to find one.");
  if (scope && !scope.has(page.id)) throw new ToolError("That page isn't shared in this conversation. Ask the user to add it.");
  return page;
}

function snippet(text, query) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at < 0 ? 0 : at - 60);
  return (start ? "…" : "") + flat.slice(start, start + 180) + (flat.length > start + 180 ? "…" : "");
}

export function searchPages(data, { query }, scope = null) {
  const q = query.trim().toLowerCase();
  if (!q) throw new ToolError("Give some words to search for.");
  const words = q.split(/\s+/).filter(Boolean);
  return {
    pages: visible(data, scope)
      .map((p) => {
        const title = (p.title || "").toLowerCase(), text = (p.plainText || "").toLowerCase();
        const score = words.reduce((s, w) => s + (title.includes(w) ? 10 : 0) + Math.min(5, text.split(w).length - 1), 0) + (title.includes(q) ? 20 : 0);
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.p.updatedAt - a.p.updatedAt)
      .slice(0, 20)
      .map(({ p }) => ({ id: p.id, title: p.title, path: pagePath(data, p.id), snippet: snippet(p.plainText, words[0]) })),
  };
}

export function listPages(data, { parent_id }, scope = null) {
  const pages = visible(data, scope);
  const ids = new Set(pages.map((p) => p.id));
  if (parent_id) findPage(data, parent_id, scope);
  // In a limited scope, a page whose parent isn't shared shows at the top.
  const children = pages.filter((p) => parent_id ? p.parentId === parent_id : !p.parentId || !ids.has(p.parentId));
  return {
    pages: children.slice(0, 300).map((p) => ({
      id: p.id, title: p.title, path: pagePath(data, p.id),
      child_pages: pages.filter((c) => c.parentId === p.id).length,
    })),
  };
}

export function getPage(data, { id: pageId }, scope = null) {
  const page = findPage(data, pageId, scope);
  return { id: page.id, title: page.title, path: pagePath(data, page.id), updated_at: page.updatedAt, markdown: docToMarkdown(page.content) };
}

export function listTasks(data, { status = "open" }, scope = null) {
  const titles = new Map(data.pages.map((p) => [p.id, p.title]));
  return {
    tasks: data.tasks
      .filter((t) => (status === "all" || (status === "done") === !!t.done) && (!scope || (t.pageId && scope.has(t.pageId))))
      .slice(0, 300)
      .map((t) => ({ id: t.id, title: t.text, due: t.due || "", done: !!t.done, priority: t.priority || "", page_id: t.pageId || null, page_title: t.pageId ? titles.get(t.pageId) || "" : "" })),
  };
}

export function listFlashcards(data, { page_id }, scope = null) {
  if (page_id) findPage(data, page_id, scope);
  return {
    flashcards: data.cards
      .filter((c) => (!page_id || c.pageId === page_id) && (!scope || (c.pageId && scope.has(c.pageId))))
      .slice(0, 300)
      .map((c) => ({ id: c.id, question: c.question, answer: c.answer, page_id: c.pageId || null, due: c.due ? new Date(c.due).toISOString().slice(0, 10) : "" })),
  };
}

/**
 * deps: { parse(markdown) -> doc, newId() -> string, now?: number }
 * Returns a change to show or apply; nothing is written here.
 */
export function planCreatePage(data, { title, markdown, parent_id }, deps, scope = null) {
  const name = title.trim();
  if (!name) throw new ToolError("Give the page a title.");
  if (parent_id) findPage(data, parent_id, scope);
  const content = deps.parse(markdown);
  return { kind: "create_page", title: name, parentId: parent_id || null, content, markdown, pageId: deps.newId() };
}

export function planUpdatePage(data, { id: pageId, markdown, mode }, deps, scope = null) {
  const page = findPage(data, pageId, scope);
  const added = deps.parse(markdown);
  if (mode === "replace" && hasPictures(page.content))
    throw new ToolError("This page has images that Markdown can't carry, so it can't be replaced. Use mode \"append\" instead.");
  const before = page.content;
  const after = mode === "append" ? { ...before, content: [...(before.content || []), ...(added.content || [])] } : added;
  return { kind: "update_page", pageId, title: page.title, mode, added, after,
    beforeMarkdown: docToMarkdown(before), afterMarkdown: docToMarkdown(after), basedOn: page.updatedAt };
}

export function planCreateTask(data, { title, due, page_id }, deps, scope = null) {
  const text = title.trim();
  if (!text) throw new ToolError("Describe the task.");
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ToolError("Write the due date as YYYY-MM-DD.");
  if (page_id) findPage(data, page_id, scope);
  return { kind: "create_task", task: { id: deps.newId(), pageId: page_id || null, text, due: due || "", done: false, priority: "Normal" } };
}

/**
 * Apply a change. deps.plain(doc) gives a page's searchable text.
 * Returns the new workspace and what Undo needs.
 */
export function applyChange(data, change, deps) {
  const now = deps.now ?? Date.now();
  if (change.kind === "create_page") {
    if (data.pages.some((p) => p.id === change.pageId)) throw new ToolError("This page was already created.");
    if (change.parentId && !live(data).some((p) => p.id === change.parentId)) throw new ToolError("The page it was going inside no longer exists.");
    const page = { id: change.pageId, parentId: change.parentId, title: change.title, icon: "📄", content: change.content,
      plainText: deps.plain(change.content), tags: [], favorite: false, trashed: false, createdAt: now, updatedAt: now, versions: [] };
    return { data: { ...data, pages: [...data.pages, page] }, undo: { kind: "create_page", pageId: page.id } };
  }
  if (change.kind === "update_page") {
    const page = live(data).find((p) => p.id === change.pageId);
    if (!page) throw new ToolError("That page no longer exists.");
    // Appending goes onto the page as it is now, even if it changed since the preview.
    const content = change.mode === "append"
      ? { ...page.content, content: [...(page.content.content || []), ...(change.added.content || [])] }
      : change.after;
    const versions = [...page.versions, { at: page.updatedAt, title: page.title, content: page.content }].slice(-30);
    const next = { ...page, content, plainText: deps.plain(content), updatedAt: now, versions };
    return { data: { ...data, pages: data.pages.map((p) => (p.id === page.id ? next : p)) },
      undo: { kind: "update_page", pageId: page.id, content: page.content, title: page.title } };
  }
  if (change.kind === "create_task") {
    if (change.task.pageId && !live(data).some((p) => p.id === change.task.pageId)) throw new ToolError("The task's page no longer exists.");
    return { data: { ...data, tasks: [...data.tasks, change.task] }, undo: { kind: "create_task", taskId: change.task.id } };
  }
  throw new ToolError("Unknown change.");
}

/** Undo an applied change. A created page goes to Trash rather than being deleted. */
export function undoChange(data, undo, deps) {
  const now = deps.now ?? Date.now();
  if (undo.kind === "create_page")
    return { ...data, pages: data.pages.map((p) => (p.id === undo.pageId ? { ...p, trashed: true, updatedAt: now } : p)) };
  if (undo.kind === "update_page") {
    const page = data.pages.find((p) => p.id === undo.pageId);
    if (!page) throw new ToolError("That page no longer exists.");
    const versions = [...page.versions, { at: page.updatedAt, title: page.title, content: page.content }].slice(-30);
    const next = { ...page, content: undo.content, plainText: deps.plain(undo.content), updatedAt: now, versions };
    return { ...data, pages: data.pages.map((p) => (p.id === page.id ? next : p)) };
  }
  if (undo.kind === "create_task")
    return { ...data, tasks: data.tasks.filter((t) => t.id !== undo.taskId), deleted: { ...(data.deleted || {}), [undo.taskId]: now } };
  throw new ToolError("Unknown change.");
}

/**
 * Run a tool. Reads return { result }. Writes return { change, result },
 * where result describes the proposal; the caller applies it (MCP) or shows
 * it for approval (chat).
 */
export function runTool(name, rawArgs, { data, scope = null, deps }) {
  const args = checkArgs(name, rawArgs);
  switch (name) {
    case "search_pages": return { result: searchPages(data, args, scope) };
    case "list_pages": return { result: listPages(data, args, scope) };
    case "get_page": return { result: getPage(data, args, scope) };
    case "list_tasks": return { result: listTasks(data, args, scope) };
    case "list_flashcards": return { result: listFlashcards(data, args, scope) };
    case "create_page": {
      if ((args.markdown || "").length > MAX_MARKDOWN) throw new ToolError("That page is too long.");
      const change = planCreatePage(data, args, deps, scope);
      return { change, result: { id: change.pageId, title: change.title } };
    }
    case "update_page": {
      const change = planUpdatePage(data, args, deps, scope);
      return { change, result: { id: change.pageId, title: change.title, mode: change.mode } };
    }
    case "create_task": {
      const change = planCreateTask(data, args, deps, scope);
      return { change, result: { id: change.task.id, title: change.task.text, due: change.task.due } };
    }
  }
  throw new ToolError(`There's no tool called ${name}.`);
}
