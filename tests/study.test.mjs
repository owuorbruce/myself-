import test from "node:test";
import assert from "node:assert/strict";
import { grade, schedule, streak, localDay } from "../src/grading.mjs";
import { mergeWorkspaces, rebaseEdits } from "../src/sync-merge.mjs";
import { validateWorkspace } from "../src/validation.mjs";

test("typed answers are graded right, close or wrong", () => {
  assert.equal(grade("Osteoclasts", "osteoclasts|osteoclast"), "right");
  assert.equal(grade("the osteoclast", "osteoclasts|osteoclast"), "right");
  assert.equal(grade("osteoclats", "osteoclasts"), "close");
  assert.equal(grade("parathyroid", "parathyroid hormone"), "close");
  assert.equal(grade("osteoblasts", "osteocytes"), "wrong");
  assert.equal(grade("", "anything"), "wrong");
  assert.equal(grade("PTH", "parathyroid hormone|PTH"), "right");
});

test("reviews space out when right and come back soon when wrong", () => {
  const now = 1_000_000;
  const first = schedule({}, 2, now);
  assert.equal(first.interval, 1);
  const second = schedule(first, 2, now);
  assert.ok(second.interval > 2);
  const missed = schedule(second, 0, now);
  assert.equal(missed.interval, 0);
  assert.equal(missed.due, now + 10 * 60000);
  assert.ok(missed.ease < second.ease);
});

test("streak counts consecutive days and survives until the day ends", () => {
  const day = 86400000;
  const now = new Date(2026, 9, 4, 20).getTime();
  const days = [localDay(now - 2 * day), localDay(now - day)];
  assert.equal(streak(days, now), 2);
  assert.equal(streak([...days, localDay(now)], now), 3);
  assert.equal(streak([localDay(now - 3 * day)], now), 0);
});

const page = (id, title, updatedAt, extra = {}) => ({
  id,
  parentId: null,
  title,
  icon: "📄",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  plainText: "",
  tags: [],
  favorite: false,
  trashed: false,
  createdAt: 1,
  updatedAt,
  versions: [],
  ...extra,
});
const workspace = (pages, extra = {}) => ({
  schema: 1,
  pages,
  tasks: [],
  cards: [],
  attachments: [],
  collections: [],
  study: { items: [], days: [] },
  settings: { theme: "system", font: "sans", wide: false },
  ...extra,
});

test("sync merge keeps the newer page and adds pages from both devices", () => {
  const local = workspace([page("a", "A local", 300), page("b", "Only here", 300)]);
  const remote = workspace([page("a", "A remote", 200), page("c", "Only there", 250)]);
  const { data, conflicts } = mergeWorkspaces(local, remote, { lastSync: 100 }, () => "new");
  assert.deepEqual(data.pages.map((p) => p.id).sort(), ["a", "b", "c", "new"]);
  assert.equal(conflicts.length, 1, "edited on both sides keeps a copy");
  const quiet = mergeWorkspaces(local, remote, { lastSync: 250 }, () => "x");
  assert.equal(quiet.conflicts.length, 0);
  assert.equal(quiet.data.pages.find((p) => p.id === "a").title, "A local");
});

test("sync merge respects deletions and fixes orphans", () => {
  const local = workspace([page("p", "Parent", 10)], { deleted: { p: Date.now() } });
  local.pages = [];
  const remote = workspace([
    page("p", "Parent", 10),
    page("child", "Child", 10, { parentId: "p" }),
  ]);
  const { data } = mergeWorkspaces(local, remote, { lastSync: 0 }, () => "x");
  assert.deepEqual(data.pages.map((p) => p.id), ["child"]);
  assert.equal(data.pages[0].parentId, null);
  assert.equal(remote.pages[1].parentId, "p", "inputs are not modified");
  assert.doesNotThrow(() => validateWorkspace(data));
});

test("edits made during a sync are kept", () => {
  const before = workspace([page("a", "A", 1)]);
  const current = { ...before, pages: [page("a", "A edited", 5), page("n", "New", 5)] };
  const merged = workspace([page("a", "A", 1), page("r", "From phone", 3)]);
  const out = rebaseEdits(before, current, merged);
  assert.deepEqual(out.pages.map((p) => p.title).sort(), ["A edited", "From phone", "New"]);
});

test("backups with interactive blocks and study data validate", () => {
  const w = workspace([
    page("p", "Bones", 1, {
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Bone is broken down by " },
              { type: "blank", attrs: { id: "b1", answer: "osteoclasts" } },
            ],
          },
          {
            type: "reveal",
            attrs: { id: "r1", question: "What is PTH?" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "A hormone" }] }],
          },
          {
            type: "labelImage",
            attrs: {
              id: "l1",
              src: "data:image/png;base64,AAAA",
              boxes: [{ id: "x", x: 1, y: 2, w: 10, h: 5, answer: "femur" }],
            },
          },
        ],
      },
    }),
  ]);
  w.study.items.push({
    id: "blank:b1",
    pageId: "p",
    kind: "blank",
    prompt: "Bone is broken down by _____",
    answer: "osteoclasts",
    right: 1,
    wrong: 2,
    due: 5,
    interval: 0,
    ease: 2.1,
    last: 4,
  });
  w.study.days.push("2026-10-04");
  assert.doesNotThrow(() => validateWorkspace(w));
  const bad = structuredClone(w);
  bad.pages[0].content.content[2].attrs.src = "https://example.com/x.png";
  assert.throws(() => validateWorkspace(bad));
});
