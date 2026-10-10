import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./load-source.mjs";
import { SlateRepo, runRepoTool } from "../mcp-remote/src/repo.mjs";
import { allowed } from "../mcp-remote/src/allow.mjs";

const { types, markdown, cleanup } = await loadSource();
after(cleanup);
let n = 0;
const deps = { parse: markdown.parseRich, plain: types.plain, newId: () => "id" + ++n };
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const page = (id, title, text, updatedAt = 1) => ({ id, parentId: null, title, icon: "📄", content: { type: "doc", content: [para(text)] },
  plainText: text, tags: [], favorite: false, trashed: false, createdAt: 1, updatedAt, versions: [] });
const workspace = (pages) => ({ schema: 1, pages, tasks: [], cards: [], attachments: [{ id: "file1", pageId: pages[0].id, name: "a.pdf", type: "application/pdf", size: 3, text: "" }],
  collections: [], study: { items: [], days: [] }, settings: { theme: "system", font: "sans", wide: false } });
const b64 = (data) => Buffer.from(JSON.stringify(data)).toString("base64");

/** A fake GitHub: the repo's workspace.json, which can change between a read and a write. */
function github({ data, isPrivate = true, push = true, interleave = null }) {
  const state = { data, sha: "sha1", puts: [], paths: [] };
  const fetch = async (url, init = {}) => {
    const path = url.replace("https://api.github.com/repos/me/slate-notes", "");
    state.paths.push((init.method || "GET") + " " + path);
    assert.equal(init.headers.Authorization, "Bearer secret-token");
    if (path === "") return Response.json({ private: isPrivate, permissions: { push } });
    if (path === "/contents/slate/workspace.json" && (init.method || "GET") === "GET")
      return Response.json({ sha: state.sha, encoding: "base64", content: b64(state.data) });
    if (path === "/contents/slate/workspace.json" && init.method === "PUT") {
      const body = JSON.parse(init.body);
      if (interleave) { const f = interleave; interleave = null; f(state); }
      if (body.sha !== state.sha) return new Response("{}", { status: 409 });
      state.data = JSON.parse(Buffer.from(body.content, "base64").toString());
      state.sha = "sha" + (state.puts.length + 2);
      state.puts.push(body.message);
      return Response.json({ content: { sha: state.sha } });
    }
    throw new Error("unexpected " + path);
  };
  return { state, repo: new SlateRepo({ token: "secret-token", repo: "me/slate-notes", fetch }) };
}

test("reads the synced notes and refuses a public repository", async () => {
  const { repo } = github({ data: workspace([page("p", "Bones", "Osteoclasts break down bone.")]) });
  const found = await runRepoTool(repo, "search_pages", { query: "osteoclasts" }, deps);
  assert.equal(found.pages[0].title, "Bones");
  const open = github({ data: workspace([page("p", "Bones", "x")]), isPrivate: false });
  await assert.rejects(runRepoTool(open.repo, "list_pages", {}, deps), /public/);
  assert.deepEqual(open.state.paths, ["GET "], "nothing is read from a public repository");
  const readOnly = github({ data: workspace([page("p", "Bones", "x")]), push: false });
  await assert.rejects(runRepoTool(readOnly.repo, "list_pages", {}, deps), /can read but not write/);
});

test("old Tap to Learn blocks in synced data are read as toggles", async () => {
  const w = workspace([page("p", "Bones", "x")]);
  w.pages[0].content.content.push({ type: "reveal", attrs: { id: "r", question: "What is PTH?" }, content: [para("A hormone")] });
  const { repo } = github({ data: w });
  const md = (await runRepoTool(repo, "get_page", { id: "p" }, deps)).markdown;
  assert.match(md, /<summary>What is PTH\?<\/summary>/);
});

test("a write is committed in Slate's sync format and keeps attachments untouched", async () => {
  const { repo, state } = github({ data: workspace([page("p", "Bones", "Old text.")]) });
  const result = await runRepoTool(repo, "update_page", { id: "p", markdown: "New line.", mode: "append" }, deps);
  assert.equal(result.saved, true);
  assert.deepEqual(state.puts, ["Slate MCP: update_page"]);
  const saved = state.data.pages[0];
  assert.match(saved.plainText, /New line/);
  assert.equal(saved.versions.length, 1, "snapshot kept");
  assert.equal(state.data.attachments[0].id, "file1");
  assert.equal(state.data.schema, 1);
});

test("if Slate syncs in between, a page changed in both places keeps both versions", async () => {
  const { repo, state } = github({
    data: workspace([page("p", "Bones", "Original.")]),
    // The phone syncs an edit to the same page just before the server's write lands.
    interleave: (s) => { s.data = workspace([page("p", "Bones", "Edited on the phone.", 50)]); s.sha = "phone"; },
  });
  await runRepoTool(repo, "update_page", { id: "p", markdown: "Rewritten by the AI.", mode: "replace" }, deps);
  const titles = state.data.pages.map((p) => [p.title, p.plainText.trim()]);
  assert.equal(titles.length, 2);
  assert.ok(titles.some(([, text]) => text === "Rewritten by the AI."));
  assert.ok(titles.some(([title, text]) => /from other device/.test(title) && text === "Edited on the phone."));
});

test("new pages and tasks survive a concurrent sync without conflict copies", async () => {
  const { repo, state } = github({
    data: workspace([page("p", "Bones", "Original.")]),
    interleave: (s) => { s.data = workspace([page("p", "Bones", "Original."), page("q", "Muscles", "From the laptop.", 50)]); s.sha = "laptop"; },
  });
  await runRepoTool(repo, "create_page", { title: "Summary", markdown: "# Key ideas" }, deps);
  assert.deepEqual(state.data.pages.map((p) => p.title).sort(), ["Bones", "Muscles", "Summary"]);
});

test("only the configured GitHub account is allowed", () => {
  assert.equal(allowed({ ALLOWED_GITHUB_USER: "OwuorBruce" }, "owuorbruce"), true);
  assert.equal(allowed({ ALLOWED_GITHUB_USER: "owuorbruce" }, "someone-else"), false);
  assert.equal(allowed({ ALLOWED_GITHUB_USER: "" }, ""), false);
  assert.equal(allowed({}, undefined), false);
});
