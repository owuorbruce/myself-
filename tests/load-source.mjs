// Run the real TypeScript helpers in Node, with only IndexedDB replaced.
import ts from "typescript";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadSource() {
  const dir = await mkdtemp(join(tmpdir(), "slate-tests-"));
  for (const name of ["types", "questions", "study", "sync", "markdown"]) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText.replace(/from "(\.\/[^".]+)"/g, 'from "$1.mjs"');
    await writeFile(join(dir, name + ".mjs"), out);
  }
  for (const name of ["grading", "sync-merge", "validation", "toggle", "doc-markdown", "note-tools"]) {
    await writeFile(join(dir, name + ".mjs"), await readFile(new URL(`../src/${name}.mjs`, import.meta.url)));
  }
  await writeFile(join(dir, "storage.mjs"), `
    export const local = new Map(), files = new Map();
    export const getLocal = async (id) => local.get(id);
    export const setLocal = async (id, data) => local.set(id, data);
    export const getFile = async (id) => files.get(id);
    export const putFile = async (id, blob) => files.set(id, blob);
    export const normalize = (data) => data;
  `);
  const modules = {};
  for (const name of ["types", "questions", "study", "sync", "storage", "markdown", "note-tools"]) {
    modules[name] = await import(pathToFileURL(join(dir, name + ".mjs")));
  }
  return { ...modules, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
