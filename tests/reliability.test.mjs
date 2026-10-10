import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./load-source.mjs";
import { grade, gradeRating, gradeCorrect } from "../src/grading.mjs";
import { mergeWorkspaces, prepareRestore } from "../src/sync-merge.mjs";
import { validateWorkspace } from "../src/validation.mjs";

const { types, questions, study, sync, storage, cleanup } = await loadSource();
after(cleanup);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => { storage.local.clear(); storage.files.clear(); });
const page = (id, text = "Note") => ({ ...types.newPage(text), id, createdAt: 1, updatedAt: 1 });
const workspace = (extra = {}) => ({ schema: 1, pages: [page("p")], tasks: [], cards: [],
  attachments: [], collections: [], study: { items: [], days: [] },
  settings: { theme: "system", font: "sans", wide: false }, ...extra });
const task = { id: "t", pageId: "p", text: "Study", due: "", done: false, priority: "normal" };
const collection = { id: "c", name: "Notes", view: "table", fields: [{ id: "f", name: "Text", type: "text" }],
  rows: [{ id: "r1", values: { f: "Original" } }] };
let serial = 0;
const merge = (a, b, base) => mergeWorkspaces(a, b, { lastSync: 2, dirty: true, base }, () => "copy" + ++serial);
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const remote = (data, sha = "remote") => response({ sha, encoding: "base64", content: Buffer.from(JSON.stringify(data)).toString("base64") });
const config = { token: "test-only", repo: "test/private" };

function fakeAPI(data, options = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = url.split("/contents/")[1];
    calls.push({ path, method: init.method || "GET", body: init.body && JSON.parse(init.body) });
    if (path === "slate/workspace.json") {
      if (init.method === "PUT") return response({ content: { sha: "uploaded" } });
      return data ? remote(data) : response({}, 404);
    }
    if (path === "slate/attachments") return response(options.files || []);
    if (init.method === "PUT") return response({}, options.uploadStatus || 201);
    return new Response(options.bytes || "", { status: options.downloadStatus || 404 });
  };
  return calls;
}

test("first sync retains newly imported notes and remote notes", async () => {
  const imported = page("imported", "My imported markdown");
  const local = workspace({ pages: [imported] });
  const calls = fakeAPI(workspace());
  const result = await sync.syncNow(config, local);
  assert.deepEqual(result.data.pages.map((p) => p.id).sort(), ["imported", "p"]);
  assert.deepEqual(local.pages, [imported]);
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
});

test("failed first pull preserves all local pages", async () => {
  const local = workspace({ pages: [page("imported", "Imported")] });
  globalThis.fetch = async () => response({}, 500);
  await assert.rejects(sync.syncNow(config, local), /Couldn't read/);
  assert.equal(local.pages[0].title, "Imported");
  assert.equal((await sync.getState()).dirty, true);
});

test("remote task completion survives an unrelated local note edit", () => {
  const base = workspace({ tasks: [task] });
  const local = { ...base, pages: [page("p", "Edited note")] };
  const remote = { ...base, tasks: [{ ...task, done: true }] };
  assert.equal(merge(local, remote, base).data.tasks[0].done, true);
});

test("independent task and card field edits merge", () => {
  const card = { id: "card", pageId: "p", question: "Q", answer: "A", due: 1, interval: 0 };
  const base = workspace({ tasks: [task], cards: [card] });
  const local = { ...base, tasks: [{ ...task, text: "New text" }], cards: [{ ...card, answer: "New answer" }] };
  const remote = { ...base, tasks: [{ ...task, done: true }], cards: [{ ...card, due: 100, interval: 1 }] };
  const out = merge(local, remote, base);
  assert.equal(out.data.tasks[0].text, "New text");
  assert.equal(out.data.tasks[0].done, true);
  assert.equal(out.data.cards[0].answer, "New answer");
  assert.equal(out.data.cards[0].due, 100);
  assert.equal(out.conflicts.length, 0);
});

test("collection rows added on both devices are preserved", () => {
  const base = workspace({ collections: [collection] });
  const local = workspace({ collections: [{ ...collection, rows: [...collection.rows, { id: "r2", values: { f: "Laptop" } }] }] });
  const remote = workspace({ collections: [{ ...collection, rows: [...collection.rows, { id: "r3", values: { f: "Phone" } }] }] });
  const inputs = JSON.stringify([base, local, remote]);
  const out = merge(local, remote, base);
  assert.deepEqual(out.data.collections[0].rows.map((r) => r.id), ["r1", "r2", "r3"]);
  assert.equal(JSON.stringify([base, local, remote]), inputs);
  assert.doesNotThrow(() => validateWorkspace(out.data));
});

test("collection row removals and independent cell edits merge", () => {
  const c = { ...collection, fields: [...collection.fields, { id: "g", name: "Other", type: "text" }],
    rows: [...collection.rows, { id: "r2", values: { f: "Two", g: "Before" } }] };
  const base = workspace({ collections: [c] });
  const local = workspace({ collections: [{ ...c, rows: [{ id: "r2", values: { f: "Local", g: "Before" } }] }] });
  const remote = workspace({ collections: [{ ...c, rows: [c.rows[0], { id: "r2", values: { f: "Two", g: "Remote" } }] }] });
  assert.deepEqual(merge(local, remote, base).data.collections[0].rows, [{ id: "r2", values: { f: "Local", g: "Remote" } }]);
});

test("conflicting collection values keep a valid recovery copy", () => {
  const base = workspace({ collections: [collection] });
  const local = workspace({ collections: [{ ...collection, rows: [{ id: "r1", values: { f: "Laptop" } }] }] });
  const remote = workspace({ collections: [{ ...collection, rows: [{ id: "r1", values: { f: "Phone" } }] }] });
  const out = merge(local, remote, base);
  assert.equal(out.data.collections.length, 2);
  assert.deepEqual(out.data.collections.map((c) => c.rows[0].values.f), ["Laptop", "Phone"]);
  assert.doesNotThrow(() => validateWorkspace(out.data));
});

test("a missing baseline preserves conflicting task versions", () => {
  const out = merge(workspace({ tasks: [task] }), workspace({ tasks: [{ ...task, text: "Phone task" }] }));
  assert.equal(out.data.tasks.length, 2);
  assert.doesNotThrow(() => validateWorkspace(out.data));
});

test("numeric signs, decimal points and scientific near misses never pass", () => {
  for (const [input, answer] of [["-5", "5"], ["1.5", "15"], ["1/2", "12"], ["osteoblast", "osteoclast"], ["hypothyroidism", "hyperthyroidism"], ["gas", "ga"]]) {
    const result = grade(input, answer);
    assert.equal(gradeCorrect(result), false, input);
    assert.equal(gradeRating(result), 0, input);
  }
  assert.equal(grade("−5", "-5"), "right");
  assert.equal(grade("PTH", "parathyroid hormone|PTH"), "right");
});

test("close answers record a miss and a short retry interval", () => {
  const data = study.recordAttempt(workspace(), { id: "blank:b", pageId: "p", kind: "blank", prompt: "Q", answer: "osteoclast", rating: gradeRating(grade("osteoblast", "osteoclast")) }, 100);
  assert.equal(data.study.items[0].right, 0);
  assert.equal(data.study.items[0].wrong, 1);
  assert.equal(data.study.items[0].interval, 0);
});

const blankPage = (answer) => ({ ...page("p"), content: { type: "doc", content: [{ type: "paragraph", content: [
  { type: "text", text: "Current sentence " }, { type: "blank", attrs: { id: "b", answer } },
] }] } });
const item = { id: "blank:b", pageId: "p", kind: "blank", prompt: "Old sentence", answer: "Old answer", right: 0, wrong: 1, due: 0, interval: 0, ease: 2.5, last: 1 };

test("legacy blank reviews resolve the latest prompt and answer", () => {
  const q = study.itemQuestion(item, [blankPage("New answer")]);
  assert.equal(q.answer, "New answer");
  assert.equal(q.prompt, "Current sentence _____");
  assert.deepEqual(q.ref, { node: "b" });
});

test("deleted blanks disappear from daily, weak and due counts", () => {
  const data = workspace({ study: { items: [item], days: [] } });
  assert.equal(study.itemQuestion(item, data.pages), null);
  assert.equal(study.dailyQueue(data).length, 0);
  assert.equal(study.weakQueue(data).length, 0);
  assert.equal(study.weakSpots(data).length, 0);
  assert.equal(study.dueCount(data), 0);
});

test("automatic questions become invalid after their source changes", () => {
  const node = { type: "paragraph", content: [{ type: "text", text: "Osteoclasts", marks: [{ type: "bold" }] }, { type: "text", text: " break down bone during remodelling." }] };
  const q = questions.questionsFrom(node, "p")[0];
  const i = { ...item, id: q.key, kind: "auto", prompt: q.prompt, answer: q.answer };
  assert.ok(study.itemQuestion(i, [{ ...page("p"), content: { type: "doc", content: [node] } }]));
  assert.equal(study.itemQuestion(i, [page("p")]), null);
});

test("lesson question extraction keeps formatted toggle answers", () => {
  const node = { type: "details", attrs: { id: "r" }, content: [
    { type: "detailsSummary", content: [{ type: "text", text: "Q" }] },
    { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
  ] };
  const q = questions.questionsFrom(node, "p", () => "<p>A</p>")[0];
  assert.equal(q.answerHtml, "<p>A</p>");
  assert.equal(q.key, "reveal:r");
  assert.equal(q.mode, "self");
});

test("backup replacement syncs after a previously clean sync", async () => {
  const before = workspace({ pages: [page("p"), page("removed")], tasks: [task] });
  await sync.setState({ sha: "remote", lastSync: 2, dirty: false });
  storage.local.set("syncBase", before);
  const restored = prepareRestore(before, workspace({ pages: [page("p", "Restored note")] }), 100);
  assert.equal(restored.deleted.removed, 100);
  assert.equal(restored.deleted.t, 100);
  await sync.markDirty();
  const calls = fakeAPI(before);
  await sync.syncNow(config, restored);
  const put = calls.find((c) => c.method === "PUT" && c.path === "slate/workspace.json");
  const written = JSON.parse(Buffer.from(put.body.content, "base64").toString());
  assert.equal(written.pages[0].title, "Restored note");
  assert.equal(written.pages.length, 1);
  assert.equal((await sync.getState()).dirty, false);
  assert.deepEqual(storage.local.get("syncBase"), written);
});

test("restoring a previously deleted page removes its tombstone", () => {
  const out = prepareRestore(workspace({ pages: [], deleted: { p: 10 } }), workspace(), 100);
  assert.equal(out.deleted.p, undefined);
  assert.doesNotThrow(() => validateWorkspace(out));
});

const attachment = { id: "file", pageId: "p", name: "notes.pdf", type: "application/pdf", size: 3, text: "" };
const withFile = () => workspace({ attachments: [attachment] });

for (const status of [404, 500]) test(`attachment download ${status} stops sync without a workspace upload`, async () => {
  const calls = fakeAPI(withFile(), { downloadStatus: status });
  await assert.rejects(sync.syncNow(config, workspace()), /Couldn't download notes.pdf/);
  assert.equal(calls.some((c) => c.method === "PUT"), false);
  assert.equal((await sync.getState()).dirty, true);
});

test("missing local attachment stops first upload", async () => {
  const calls = fakeAPI(null);
  await assert.rejects(sync.syncNow(config, withFile()), /Couldn't download/);
  assert.equal(calls.some((c) => c.method === "PUT"), false);
});

test("incomplete attachment download never saves bytes or marks sync complete", async () => {
  fakeAPI(withFile(), { bytes: "x", downloadStatus: 200 });
  await assert.rejects(sync.syncNow(config, workspace()), /incomplete/);
  assert.equal(storage.files.has("file"), false);
  assert.equal((await sync.getState()).dirty, true);
});

test("incomplete local attachment stops sync", async () => {
  storage.files.set("file", new Blob(["x"]));
  const calls = fakeAPI(null);
  await assert.rejects(sync.syncNow(config, withFile()), /incomplete bytes/);
  assert.equal(calls.some((c) => c.method === "PUT"), false);
});

test("attachment upload 422 is an error, never false success", async () => {
  storage.files.set("file", new Blob(["abc"]));
  const calls = fakeAPI(null, { uploadStatus: 422 });
  await assert.rejects(sync.syncNow(config, withFile()), /Couldn't upload notes.pdf \(422\)/);
  assert.equal(calls.some((c) => c.path === "slate/workspace.json" && c.method === "PUT"), false);
  assert.equal((await sync.getState()).dirty, true);
});

test("successful attachment transfer finishes before metadata and stores baseline", async () => {
  storage.files.set("file", new Blob(["abc"]));
  const calls = fakeAPI(null);
  await sync.syncNow(config, withFile());
  assert.deepEqual(calls.filter((c) => c.method === "PUT").map((c) => c.path), ["slate/attachments/file", "slate/workspace.json"]);
  assert.equal((await sync.getState()).dirty, false);
  assert.equal(storage.local.get("syncBase").attachments[0].id, "file");
});

test("nested blanks remain available using their current answers", () => {
  const p = blankPage("Nested current answer");
  p.content.content = [{ type: "details", attrs: { id: "t" }, content: [
    { type: "detailsSummary", content: [{ type: "text", text: "Q" }] },
    { type: "detailsContent", content: p.content.content },
  ] }];
  assert.equal(study.itemQuestion(item, [p]).answer, "Nested current answer");
});

test("baseline comparison preserves page changes despite device clock differences", () => {
  const base = workspace();
  base.pages[0].updatedAt = 500;
  const remote = workspace({ pages: [{ ...page("p", "Phone edit"), updatedAt: 100 }] });
  assert.equal(merge(base, remote, base).data.pages[0].title, "Phone edit");
});

test("a concurrently edited value keeps its removed field for recovery", () => {
  const base = workspace({ collections: [collection] });
  const local = workspace({ collections: [{ ...collection, fields: [], rows: [{ id: "r1", values: {} }] }] });
  const remote = workspace({ collections: [{ ...collection, rows: [{ id: "r1", values: { f: "Phone edit" } }] }] });
  const out = merge(local, remote, base).data;
  assert.equal(out.collections[0].fields[0].id, "f");
  assert.equal(out.collections[0].rows[0].values.f, "Phone edit");
  assert.doesNotThrow(() => validateWorkspace(out));
});

test("incomplete remote attachment prevents a false successful upload", async () => {
  storage.files.set("file", new Blob(["abc"]));
  const calls = fakeAPI(null, { files: [{ name: "file", size: 1 }] });
  await assert.rejects(sync.syncNow(config, withFile()), /Synced attachment notes.pdf is incomplete/);
  assert.equal(calls.some((c) => c.path === "slate/workspace.json" && c.method === "PUT"), false);
});

test("restored pages and tasks survive old remote deletion markers", () => {
  const now = Date.now();
  const before = workspace({ pages: [], deleted: { p: now - 1000, t: now - 1000 } });
  const restored = prepareRestore(before, workspace({ tasks: [task] }), now);
  const remote = { ...before, pages: [page("other", "Other device")] };
  const out = merge(restored, remote, before).data;
  assert.ok(out.pages.some((p) => p.id === "p"));
  assert.ok(out.tasks.some((t) => t.id === "t"));
  assert.doesNotThrow(() => validateWorkspace(out));
});

test("a new deletion after restore still wins", () => {
  const now = Date.now();
  const restored = prepareRestore(workspace(), workspace(), now - 1000);
  const deleted = workspace({ pages: [], deleted: { p: now } });
  assert.equal(merge(restored, deleted, restored).data.pages.length, 0);
});
