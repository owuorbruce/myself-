import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./load-source.mjs";
import { docToMarkdown } from "../src/doc-markdown.mjs";
import { validateWorkspace } from "../src/validation.mjs";

const { types, markdown, "note-tools": tools, cleanup } = await loadSource();
after(cleanup);
let n = 0;
const deps = { parse: markdown.parseRich, plain: types.plain, newId: () => "new" + ++n, now: 5000 };
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const page = (id, title, parentId = null, content = [para(title + " text")], extra = {}) => ({
  id, parentId, title, icon: "📄", content: { type: "doc", content }, plainText: types.plain({ type: "doc", content }),
  tags: [], favorite: false, trashed: false, createdAt: 1, updatedAt: 1, versions: [], ...extra,
});
const workspace = () => ({
  schema: 1,
  pages: [
    page("school", "School"),
    page("bones", "Bones", "school", [para("Osteoclasts break down bone."), para("Osteoblasts build it.")]),
    page("lab", "Lab 2", "school"),
    page("old", "Old bones", null, [para("bone")], { trashed: true }),
    page("pic", "Diagram", null, [{ type: "labelImage", attrs: { id: "l", src: "data:image/png;base64,AA", boxes: [] } }]),
  ],
  tasks: [{ id: "t1", pageId: "bones", text: "Revise bones", due: "2026-11-01", done: false, priority: "Normal" },
    { id: "t2", pageId: null, text: "Buy milk", due: "", done: true, priority: "Normal" }],
  cards: [{ id: "c1", pageId: "bones", question: "What breaks bone?", answer: "Osteoclasts", due: 0, interval: 0 }],
  attachments: [], collections: [], study: { items: [], days: [] }, settings: { theme: "system", font: "sans", wide: false },
});
const run = (name, args, extra = {}) => tools.runTool(name, args, { data: workspace(), deps, ...extra });

test("search finds live pages with path and snippet, never trashed ones", () => {
  const { pages } = run("search_pages", { query: "bone" }).result;
  assert.deepEqual(pages.map((p) => p.id), ["bones"]);
  assert.equal(pages[0].path, "School / Bones");
  assert.match(pages[0].snippet, /Osteoclasts/);
});

test("the page tree lists children with counts", () => {
  assert.deepEqual(run("list_pages", {}).result.pages.map((p) => [p.id, p.child_pages]), [["school", 2], ["pic", 0]]);
  assert.deepEqual(run("list_pages", { parent_id: "school" }).result.pages.map((p) => p.id), ["bones", "lab"]);
});

test("get_page returns Markdown, toggles as <details>", () => {
  const w = workspace();
  w.pages[1].content.content.push({ type: "details", attrs: { id: "t" }, content: [
    { type: "detailsSummary", content: [{ type: "text", text: "Why?" }] },
    { type: "detailsContent", content: [para("Because.")] },
  ] });
  const md = tools.runTool("get_page", { id: "bones" }, { data: w, deps }).result.markdown;
  assert.equal(md, "Osteoclasts break down bone.\n\nOsteoblasts build it.\n\n<details>\n<summary>Why?</summary>\n\nBecause.\n\n</details>");
  assert.throws(() => run("get_page", { id: "old" }), /No page/);
});

test("arguments are checked", () => {
  assert.throws(() => run("get_page", {}), /Missing id/);
  assert.throws(() => run("get_page", { id: "bones", extra: 1 }), /Unexpected/);
  assert.throws(() => run("update_page", { id: "bones", markdown: "x", mode: "overwrite" }), /must be one of/);
  assert.throws(() => run("delete_page", { id: "bones" }), /no tool/);
  assert.equal(tools.NOTE_TOOLS.some((t) => /delete/.test(t.name)), false);
});

test("create_page proposes a page from Markdown and applying it adds a valid page", () => {
  const { change, result } = run("create_page", { title: "Summary", markdown: "# Key ideas\n\n- one\n- two\n\n<details>\n<summary>Q?</summary>\n\nA.\n\n</details>", parent_id: "school" });
  assert.equal(result.title, "Summary");
  assert.deepEqual(change.content.content.map((b) => b.type), ["heading", "bulletList", "details"]);
  const before = workspace();
  const { data, undo } = tools.applyChange(before, change, deps);
  const created = data.pages.at(-1);
  assert.equal(created.parentId, "school");
  assert.match(created.plainText, /Key ideas/);
  assert.doesNotThrow(() => validateWorkspace(data));
  const undone = tools.undoChange(data, undo, deps);
  assert.equal(undone.pages.find((p) => p.id === created.id).trashed, true, "undo moves it to Trash");
});

test("update_page keeps a snapshot, appends to the current page, and undoes", () => {
  const { change } = run("update_page", { id: "bones", markdown: "Osteocytes live in lacunae.", mode: "append" });
  assert.match(change.afterMarkdown, /Osteoblasts build it\.\n\nOsteocytes/);
  const w = workspace();
  // The user edits the page after the preview: the append goes onto that version.
  w.pages[1] = { ...w.pages[1], content: { type: "doc", content: [para("Edited by me.")] }, updatedAt: 9 };
  const { data, undo } = tools.applyChange(w, change, deps);
  const updated = data.pages[1];
  assert.equal(docToMarkdown(updated.content), "Edited by me.\n\nOsteocytes live in lacunae.");
  assert.equal(updated.versions.at(-1).content.content[0].content[0].text, "Edited by me.");
  const undone = tools.undoChange(data, undo, deps);
  assert.equal(docToMarkdown(undone.pages[1].content), "Edited by me.");
  assert.equal(undone.pages[1].versions.length, 2, "undo also keeps a snapshot");
});

test("replace refuses pages with pictures that Markdown can't carry", () => {
  assert.throws(() => run("update_page", { id: "pic", markdown: "x", mode: "replace" }), /images/);
  assert.ok(run("update_page", { id: "pic", markdown: "x", mode: "append" }).change);
});

test("tasks: list by status, create with a due date, undo leaves a sync tombstone", () => {
  assert.deepEqual(run("list_tasks", {}).result.tasks.map((t) => t.id), ["t1"]);
  assert.deepEqual(run("list_tasks", { status: "all" }).result.tasks.map((t) => t.id), ["t1", "t2"]);
  assert.throws(() => run("create_task", { title: "x", due: "next week" }), /YYYY-MM-DD/);
  const { change } = run("create_task", { title: "Lab report", due: "2026-11-05", page_id: "lab" });
  const { data, undo } = tools.applyChange(workspace(), change, deps);
  assert.equal(data.tasks.at(-1).text, "Lab report");
  const undone = tools.undoChange(data, undo, deps);
  assert.equal(undone.tasks.length, 2);
  assert.ok(undone.deleted[change.task.id]);
});

test("flashcards can be listed for a page", () => {
  assert.deepEqual(run("list_flashcards", { page_id: "bones" }).result.flashcards.map((c) => c.answer), ["Osteoclasts"]);
});

test("a chat scope limits reading to the pages that were shared", () => {
  const scope = new Set(["bones"]);
  assert.deepEqual(run("search_pages", { query: "text" }, { scope }).result.pages, []);
  assert.deepEqual(run("list_pages", {}, { scope }).result.pages.map((p) => p.id), ["bones"]);
  assert.throws(() => run("get_page", { id: "lab" }, { scope }), /isn't shared/);
  assert.deepEqual(run("list_tasks", { status: "all" }, { scope }).result.tasks.map((t) => t.id), ["t1"]);
  assert.throws(() => run("update_page", { id: "lab", markdown: "x", mode: "append" }, { scope }), /isn't shared/);
});
