import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mergePages } from "../src/merge-pages.mjs";
import { validateWorkspace } from "../src/validation.mjs";

async function loadMarkdown() {
  const dir = await mkdtemp(join(tmpdir(), "slate-md-"));
  for (const name of ["types", "markdown"]) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText.replace(/from "(\.\/[^".]+)"/g, 'from "$1.mjs"');
    await writeFile(join(dir, name + ".mjs"), out);
  }
  const mod = await import(pathToFileURL(join(dir, "markdown.mjs")));
  return { ...mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("Notion toggles stay toggles, nested ones included", async () => {
  const { parseRich, cleanup } = await loadMarkdown();
  const doc = parseRich(`# Toggles

- Round 1 · The big four
    - Name the 4 primary tissue types

        **Epithelial · connective · muscle · nervous**

    - [ ]  I know the big four
- Plain bullet
    - nested bullet

<details>
<summary>One layer, flat cells?</summary>
\tSimple squamous.
</details>`);
  const types = doc.content.map((n) => n.type);
  assert.deepEqual(types, ["heading", "details", "bulletList", "details"]);
  const [summary, body] = doc.content[1].content;
  assert.equal(summary.content[0].text, "Round 1 · The big four");
  assert.deepEqual(body.content.map((n) => n.type), ["details", "taskList"]);
  assert.equal(body.content[0].content[0].content[0].text, "Name the 4 primary tissue types");
  assert.equal(doc.content[3].content[0].content[0].text, "One layer, flat cells?");
  assert.ok(doc.content[1].attrs.id && doc.content[1].attrs.id !== body.content[0].attrs.id);
  await cleanup();
});

test("Notion toggle headings become sections", async () => {
  const { parseRich, cleanup } = await loadMarkdown();
  const doc = parseRich(`- ## Week 1
    Cells are the basic unit of life.

    - Mitochondria?

        The powerhouse.`);
  assert.deepEqual(doc.content.map((n) => n.type), ["heading", "paragraph", "details"]);
  assert.equal(doc.content[0].attrs.level, 2);
  assert.equal(doc.content[0].content[0].text, "Week 1");
  await cleanup();
});

test("Slate's <details> export reads back as a toggle", async () => {
  const { parseRich, cleanup } = await loadMarkdown();
  const doc = parseRich(`Intro

<details>
<summary>Is 2 &lt; 3?</summary>

Yes, **always**.

<details>
<summary>Why?</summary>

Counting.

</details>

</details>

After`);
  assert.deepEqual(doc.content.map((n) => n.type), ["paragraph", "details", "paragraph"]);
  const [summary, body] = doc.content[1].content;
  assert.equal(summary.content[0].text, "Is 2 < 3?");
  assert.deepEqual(body.content.map((n) => n.type), ["paragraph", "details"]);
  assert.equal(body.content[0].content[1].marks[0].type, "bold");
  await cleanup();
});

const page = (id, title, extra = {}) => ({
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
  updatedAt: 1,
  versions: [],
  ...extra,
});
const ws = (pages, extra = {}) => ({
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

test("adding pages from a file keeps the workspace and nests matching pages", () => {
  const current = ws([page("lab2", "Lab 2 Tissues — Exam Notes"), page("p", "Other")]);
  let n = 0;
  const incoming = ws(
    [
      page("x", "Lab 2 · Slide practice", {
        placeUnder: "lab 2 tissues",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "blank", attrs: { id: "b1", answer: "a" } }, { type: "pageLink", attrs: { id: "y", label: "Child" } }] },
            { type: "labelImage", attrs: { id: "l1", src: "data:image/png;base64,AA", boxes: [] } },
          ],
        },
      }),
      page("y", "Child", { parentId: "x" }),
      page("z", "Unplaced", { placeUnder: "Lab 9" }),
    ],
    { cards: [{ id: "c", pageId: "x", question: "q", answer: "a", due: 0, interval: 0 }] },
  );
  const { data, roots, placed } = mergePages(current, incoming, () => "n" + ++n);
  assert.equal(data.pages.length, 5);
  assert.equal(placed, 1);
  assert.equal(roots.length, 2);
  const practice = data.pages.find((p) => p.title === "Lab 2 · Slide practice");
  assert.equal(practice.parentId, "lab2");
  assert.equal(data.pages.find((p) => p.title === "Unplaced").parentId, null);
  assert.equal(data.pages.find((p) => p.title === "Child").parentId, practice.id);
  assert.ok(!("placeUnder" in practice));
  const [para, label] = practice.content.content;
  assert.notEqual(para.content[0].attrs.id, "b1", "block ids are fresh");
  assert.equal(para.content[1].attrs.id, data.pages.find((p) => p.title === "Child").id);
  assert.notEqual(label.attrs.id, "l1");
  assert.equal(data.cards[0].pageId, practice.id);
  assert.doesNotThrow(() => validateWorkspace(data));
  // Adding the same file twice gives separate copies.
  const twice = mergePages(data, incoming, () => "m" + ++n);
  assert.equal(new Set(twice.data.pages.map((p) => p.id)).size, twice.data.pages.length);
});
