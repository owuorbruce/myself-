import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkspace, canMove } from "../src/validation.mjs";
const base = () => ({
  schema: 1,
  pages: [
    {
      id: "parent",
      parentId: null,
      title: "Parent",
      icon: "📄",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      plainText: "",
      tags: [],
      favorite: false,
      trashed: false,
      createdAt: 1,
      updatedAt: 1,
      versions: [],
    },
  ],
  tasks: [],
  cards: [],
  collections: [],
  attachments: [],
  settings: { theme: "light", font: "sans", wide: false },
});
test("valid workspace can be restored with its history, tasks, cards and files", () => {
  const w = base();
  w.pages[0].versions = [
    { at: 1, title: "Earlier", content: { type: "doc", content: [] } },
  ];
  w.tasks = [
    {
      id: "task",
      pageId: "parent",
      text: "Read",
      due: "2026-10-10",
      done: false,
      priority: "Normal",
    },
  ];
  w.cards = [
    {
      id: "card",
      pageId: "parent",
      question: "Q",
      answer: "A",
      due: 1,
      interval: 0,
    },
  ];
  w.attachments = [
    {
      id: "attachment",
      pageId: "parent",
      name: "a.txt",
      type: "text/plain",
      size: 4,
      text: "read",
    },
  ];
  assert.equal(validateWorkspace(w), w);
});
test("cyclic and missing page references cannot overwrite an existing workspace", () => {
  const w = base();
  w.pages[0].parentId = "parent";
  assert.throws(() => validateWorkspace(w));
  w.pages[0].parentId = "missing";
  assert.throws(() => validateWorkspace(w));
});
test("invalid attachment references and malformed editor nodes are rejected", () => {
  const w = base();
  w.attachments = [
    {
      id: "attachment",
      pageId: "missing",
      name: "a",
      type: "text/plain",
      size: 4,
      text: "",
    },
  ];
  assert.throws(() => validateWorkspace(w));
  w.attachments = [];
  w.pages[0].content = { type: "script", text: "bad" };
  assert.throws(() => validateWorkspace(w));
});
test("remote images and duplicate IDs cannot enter a restored workspace", () => {
  const w = base();
  w.pages[0].content = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: "https://example.com/tracker.png" } },
    ],
  };
  assert.throws(() => validateWorkspace(w));
  w.pages[0].content = { type: "doc", content: [] };
  w.pages.push({ ...w.pages[0] });
  assert.throws(() => validateWorkspace(w));
});
test("page moves reject descendant cycles but allow a different parent", () => {
  const pages = [
    { id: "a", parentId: null, trashed: false },
    { id: "b", parentId: "a", trashed: false },
    { id: "c", parentId: null, trashed: false },
  ];
  assert.equal(canMove(pages, "a", "b"), false);
  assert.equal(canMove(pages, "a", "a"), false);
  assert.equal(canMove(pages, "b", "c"), true);
  assert.equal(canMove(pages, "b", null), true);
  assert.equal(canMove(pages, "b", "missing"), false);
});
