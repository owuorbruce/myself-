import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./load-source.mjs";
import { migrateContent, migrateWorkspace, studyToggle } from "../src/toggle.mjs";
import { mergeWorkspaces } from "../src/sync-merge.mjs";
import { mergePages } from "../src/merge-pages.mjs";
import { validateWorkspace } from "../src/validation.mjs";

const { types, questions, study, sync, storage, cleanup } = await loadSource();
after(cleanup);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => { storage.local.clear(); storage.files.clear(); });

const text = (t) => ({ type: "text", text: t });
const para = (t) => ({ type: "paragraph", content: [text(t)] });
const reveal = (id, question, answer) => ({ type: "reveal", attrs: { id, question }, content: [para(answer)] });
const toggle = (id, summary, blocks) => ({ type: "details", attrs: { id }, content: [
  { type: "detailsSummary", ...(summary ? { content: [text(summary)] } : {}) },
  { type: "detailsContent", content: blocks },
] });
const page = (id, content, extra = {}) => ({ ...types.newPage("Bones"), id, createdAt: 1, updatedAt: 1,
  content: { type: "doc", content }, ...extra });
const workspace = (pages, extra = {}) => ({ schema: 1, pages, tasks: [], cards: [], attachments: [], collections: [],
  study: { items: [], days: [] }, settings: { theme: "system", font: "sans", wide: false }, ...extra });

test("a reveal block becomes a toggle with the same id", () => {
  const doc = { type: "doc", content: [para("Intro"), reveal("r1", "What is PTH?", "A hormone")] };
  const next = migrateContent(doc);
  assert.deepEqual(next.content[1], toggle("r1", "What is PTH?", [para("A hormone")]));
  assert.equal(next.content[0], doc.content[0]);
  assert.deepEqual(migrateContent(next), next);
});

test("reveal blocks nested anywhere are migrated, and an empty question gives an empty summary", () => {
  const doc = { type: "doc", content: [{ type: "callout", attrs: { kind: "note" }, content: [reveal("r2", "", "Answer")] }] };
  const migrated = migrateContent(doc).content[0].content[0];
  assert.equal(migrated.type, "details");
  assert.equal(migrated.content[0].content, undefined);
});

test("workspace migration covers snapshots and leaves untouched pages alone", () => {
  const plain = page("plain", [para("Nothing to migrate")]);
  const old = page("old", [reveal("r", "Q", "A")], { versions: [{ at: 1, title: "Bones", content: { type: "doc", content: [reveal("r", "Q", "Older")] } }] });
  const w = workspace([plain, old]);
  const next = migrateWorkspace(w);
  assert.equal(next.pages[0], plain);
  assert.equal(next.pages[1].content.content[0].type, "details");
  assert.equal(next.pages[1].versions[0].content.content[0].type, "details");
  assert.equal(migrateWorkspace(next), next);
  const unchanged = workspace([plain]);
  assert.equal(migrateWorkspace(unchanged), unchanged);
});

test("backups accept both toggles and the older reveal blocks", () => {
  const w = workspace([page("a", [reveal("r", "Q", "A")]), page("b", [toggle("t", "Q", [para("A"), toggle("t2", "", [para("x")])])])]);
  assert.doesNotThrow(() => validateWorkspace(w));
  const broken = workspace([page("c", [{ type: "details", attrs: { id: 5 }, content: [] }])]);
  assert.throws(() => validateWorkspace(broken));
});

test("only toggles with a summary and text of their own feed Study", () => {
  assert.ok(studyToggle(toggle("t", "Q", [para("A")])));
  assert.equal(studyToggle(toggle("t", "", [para("A")])), null);
  assert.equal(studyToggle(toggle("t", "Q", [{ type: "paragraph" }])), null);
  assert.equal(studyToggle(toggle("t", "Section", [toggle("inner", "Q", [para("A")])])), null);
});

test("a section toggle's inner toggles are their own self-graded questions", () => {
  const node = toggle("outer", "Week 1", [toggle("a", "Q1", [para("A1")]), toggle("b", "Q2", [para("A2"), toggle("c", "Q3", [para("A3")])])]);
  const qs = questions.questionsFrom(node, "p");
  assert.deepEqual(qs.map((q) => q.key), ["reveal:a", "reveal:b", "reveal:c"]);
  assert.ok(qs.every((q) => q.mode === "self"));
  assert.equal(qs[1].prompt, "Q2");
  assert.match(qs[1].answer, /A2/);
});

test("review history from Tap to Learn carries over to the migrated toggle", () => {
  const p = page("p", migrateContent({ type: "doc", content: [reveal("r1", "What is PTH?", "A hormone")] }).content);
  const item = { id: "reveal:r1", pageId: "p", kind: "reveal", prompt: "What is PTH?", answer: "A hormone",
    ref: { node: "r1" }, right: 1, wrong: 2, due: 0, interval: 1, ease: 2.5, last: 0 };
  const q = study.itemQuestion(item, [p]);
  assert.equal(q.prompt, "What is PTH?");
  assert.equal(q.answer, "A hormone");
  assert.equal(q.mode, "self");
  assert.equal(types.plain(p.content).includes("What is PTH?"), true);
});

test("both devices migrating the same page doesn't create a conflict copy", () => {
  const old = page("p", [reveal("r", "Q", "A")]);
  const base = workspace([old]);
  const mine = migrateWorkspace(workspace([old]));
  const theirs = migrateWorkspace(workspace([old]));
  const result = mergeWorkspaces(mine, theirs, { lastSync: 2, dirty: true, base: migrateWorkspace(base) }, () => "copy");
  assert.equal(result.data.pages.length, 1);
  assert.deepEqual(result.conflicts, []);
});

test("an edit from a device still on the old version merges cleanly after migration", () => {
  const old = page("p", [reveal("r", "Q", "A")]);
  const base = workspace([old]);
  const mine = migrateWorkspace(workspace([old]));
  const theirs = migrateWorkspace(workspace([{ ...old, content: { type: "doc", content: [reveal("r", "Q", "A, edited")] }, updatedAt: 9 }]));
  const result = mergeWorkspaces(mine, theirs, { lastSync: 2, dirty: false, base: migrateWorkspace(base) }, () => "copy");
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.pages.length, 1);
  assert.match(JSON.stringify(result.data.pages[0].content), /A, edited/);
});

test("sync compares against a migrated base, so migration alone is not an edit", async () => {
  const old = page("p", [reveal("r", "Q", "A")]);
  storage.local.set("syncBase", workspace([old]));
  await sync.setState({ sha: "before", lastSync: 2, dirty: true });
  const remote = migrateWorkspace(workspace([old]));
  globalThis.fetch = async (url, init = {}) => {
    const path = url.split("/contents/")[1];
    if (path === "slate/workspace.json" && init.method === "PUT") return new Response(JSON.stringify({ content: { sha: "after" } }));
    if (path === "slate/workspace.json")
      return new Response(JSON.stringify({ sha: "remote", encoding: "base64", content: Buffer.from(JSON.stringify(remote)).toString("base64") }));
    return new Response("[]");
  };
  const result = await sync.syncNow({ token: "test-only", repo: "test/private" }, migrateWorkspace(workspace([old])));
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.pages.length, 1);
});

test("pages added from a Slate file get fresh toggle ids", () => {
  let n = 0;
  const incoming = workspace([page("in", [toggle("t", "Q", [para("A")])])]);
  const { data } = mergePages(workspace([]), incoming, () => "new" + ++n);
  const added = data.pages[0].content.content[0];
  assert.equal(added.type, "details");
  assert.notEqual(added.attrs.id, "t");
});
