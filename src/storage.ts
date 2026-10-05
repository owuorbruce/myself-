import { openDB } from "idb";
import JSZip from "jszip";
import TurndownService from "turndown";
import { generateHTML } from "@tiptap/core";
import { extensions } from "./extensions";
import { seed, type Workspace, type Page } from "./types";
import { validateWorkspace } from "./validation.mjs";
type Meta = { revision: number; split?: boolean; data: Workspace };
type PageBody = { content: Page["content"]; plainText: string };
const STORES = ["workspace", "pages", "versions", "attachText"] as const;
const db = openDB("slate-workspace", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("workspace");
      db.createObjectStore("files");
    }
    if (oldVersion < 2) {
      // Pages, their history and extracted attachment text live in their
      // own records so a keystroke only rewrites the page being edited.
      db.createObjectStore("pages");
      db.createObjectStore("versions");
      db.createObjectStore("attachText");
      db.createObjectStore("local");
    }
  },
});
/** What was last written, by reference, so saves only touch what changed. */
const written = {
  pages: new Map<
    string,
    { content: unknown; plainText: string; versions: unknown }
  >(),
  text: new Map<string, string>(),
};
function remember(data: Workspace) {
  written.pages = new Map(
    data.pages.map((p) => [
      p.id,
      { content: p.content, plainText: p.plainText, versions: p.versions },
    ]),
  );
  written.text = new Map(data.attachments.map((a) => [a.id, a.text]));
}
function metaOf(data: Workspace): Workspace {
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      content: { type: "doc" },
      plainText: "",
      versions: [],
    })),
    attachments: data.attachments.map((a) => ({ ...a, text: "" })),
  };
}
/** Fill in fields added in later versions so older data keeps working. */
export function normalize(data: Workspace): Workspace {
  return {
    ...data,
    study: data.study || { items: [], days: [] },
    settings: {
      ...data.settings,
      theme: data.settings?.theme || "system",
      font: data.settings?.font || "sans",
      wide: !!data.settings?.wide,
    },
  };
}
export async function load(): Promise<{
  revision: number;
  data: Workspace;
  migrate: boolean;
}> {
  const d = await db;
  const saved = (await d.get("workspace", "main")) as Meta | undefined;
  if (!saved) {
    written.pages.clear();
    written.text.clear();
    return { revision: 0, data: seed(), migrate: false };
  }
  if (!saved.split) {
    // A workspace from before split storage. Leave the "written" maps empty
    // so the next save stores every page in its own record.
    written.pages.clear();
    written.text.clear();
    return {
      revision: saved.revision,
      data: normalize(saved.data),
      migrate: true,
    };
  }
  const tx = d.transaction(["pages", "versions", "attachText"]);
  const [pageKeys, pageBodies, versionKeys, versionLists, textKeys, texts] =
    await Promise.all([
      tx.objectStore("pages").getAllKeys(),
      tx.objectStore("pages").getAll(),
      tx.objectStore("versions").getAllKeys(),
      tx.objectStore("versions").getAll(),
      tx.objectStore("attachText").getAllKeys(),
      tx.objectStore("attachText").getAll(),
    ]);
  const bodies = new Map(
    pageKeys.map((k, i) => [String(k), pageBodies[i] as PageBody]),
  );
  const versions = new Map(
    versionKeys.map((k, i) => [String(k), versionLists[i] as Page["versions"]]),
  );
  const text = new Map(textKeys.map((k, i) => [String(k), String(texts[i])]));
  const data = normalize({
    ...saved.data,
    pages: saved.data.pages.map((p) => ({
      ...p,
      content: bodies.get(p.id)?.content || { type: "doc", content: [] },
      plainText: bodies.get(p.id)?.plainText || "",
      versions: versions.get(p.id) || [],
    })),
    attachments: saved.data.attachments.map((a) => ({
      ...a,
      text: text.get(a.id) || "",
    })),
  });
  remember(data);
  return { revision: saved.revision, data, migrate: false };
}
export async function save(data: Workspace, revision: number) {
  const tx = (await db).transaction([...STORES], "readwrite");
  const previous = (await tx.objectStore("workspace").get("main")) as
    | Meta
    | undefined;
  if ((previous?.revision || 0) !== revision) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(
      "This workspace changed in another tab. Export your unsaved work, then reload this tab.",
    );
  }
  const pages = tx.objectStore("pages"),
    versions = tx.objectStore("versions"),
    text = tx.objectStore("attachText");
  const live = new Set<string>();
  for (const p of data.pages) {
    live.add(p.id);
    const before = written.pages.get(p.id);
    if (
      !before ||
      before.content !== p.content ||
      before.plainText !== p.plainText
    )
      void pages.put({ content: p.content, plainText: p.plainText }, p.id);
    if (!before || before.versions !== p.versions)
      void versions.put(p.versions, p.id);
  }
  for (const id of written.pages.keys())
    if (!live.has(id)) {
      void pages.delete(id);
      void versions.delete(id);
    }
  const files = new Set<string>();
  for (const a of data.attachments) {
    files.add(a.id);
    if (written.text.get(a.id) !== a.text) void text.put(a.text, a.id);
  }
  for (const id of written.text.keys())
    if (!files.has(id)) void text.delete(id);
  void tx
    .objectStore("workspace")
    .put(
      { revision: revision + 1, split: true, data: metaOf(data) } as Meta,
      "main",
    );
  await tx.done;
  remember(data);
  return revision + 1;
}
export async function putFile(id: string, file: Blob) {
  await (await db).put("files", file, id);
}
export async function getFile(id: string): Promise<Blob | undefined> {
  return (await db).get("files", id);
}
export async function removeFile(id: string) {
  const tx = (await db).transaction(["workspace", "files"], "readwrite");
  const saved = await tx.objectStore("workspace").get("main");
  if (
    !saved?.data.attachments.some(
      (a: Workspace["attachments"][number]) => a.id === id,
    )
  )
    await tx.objectStore("files").delete(id);
  await tx.done;
}
/** Device-only settings (like a sync token) that never go into backups. */
export async function getLocal<T>(key: string): Promise<T | undefined> {
  return (await db).get("local", key);
}
export async function setLocal(key: string, value: unknown) {
  const d = await db;
  if (value === undefined) await d.delete("local", key);
  else await d.put("local", value, key);
}
export async function fileIds() {
  return (await (await db).getAllKeys("files")).map(String);
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const markdown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
markdown.addRule("tasks", {
  filter: (n) =>
    n.nodeName === "LI" && n.getAttribute("data-type") === "taskItem",
  replacement: (content, n) =>
    `\n- [${(n as HTMLElement).getAttribute("data-checked") === "true" ? "x" : " "}] ${content.trim()}\n`,
});
markdown.addRule("links", {
  filter: (n) => (n as HTMLElement).hasAttribute("data-page-link"),
  replacement: (_c, n) =>
    `[[${(n as HTMLElement).getAttribute("data-label")}]]`,
});
markdown.addRule("table", {
  filter: "table",
  replacement: (_content, node) => {
    const rows = Array.from((node as HTMLElement).querySelectorAll("tr")).map(
      (r) =>
        Array.from(r.children).map(
          (c) => c.textContent?.replace(/\|/g, "\\|").replace(/\n/g, " ") || "",
        ),
    );
    if (!rows.length) return "";
    return (
      "\n\n| " +
      rows[0].join(" | ") +
      " |\n| " +
      rows[0].map(() => "---").join(" | ") +
      " |\n" +
      rows
        .slice(1)
        .map((r) => "| " + r.join(" | ") + " |")
        .join("\n") +
      "\n\n"
    );
  },
});
markdown.addRule("callout", {
  filter: (n) => n.nodeName === "ASIDE",
  replacement: (content, node) =>
    "\n\n> [" +
    ((node as HTMLElement).getAttribute("data-kind") || "note").toUpperCase() +
    "]\n" +
    content
      .trim()
      .split("\n")
      .map((l) => "> " + l)
      .join("\n") +
    "\n\n",
});
markdown.addRule("blank", {
  filter: (n) => (n as HTMLElement).hasAttribute?.("data-blank"),
  replacement: (_c, n) => `{{${(n as HTMLElement).getAttribute("data-answer")}}}`,
});
markdown.addRule("reveal", {
  filter: (n) => (n as HTMLElement).hasAttribute?.("data-reveal"),
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const question = el.querySelector("summary")?.textContent || "";
    const answer = markdown
      .turndown(el.querySelector("[data-answer]")?.innerHTML || "")
      .trim();
    return (
      "\n\n**Q: " +
      question +
      "**\n\n" +
      answer
        .split("\n")
        .map((l) => "> " + l)
        .join("\n") +
      "\n\n"
    );
  },
});
markdown.addRule("labelImage", {
  filter: (n) => (n as HTMLElement).hasAttribute?.("data-label-image"),
  replacement: (_c, node) =>
    "\n\n*Labelled image. " +
    ((node as HTMLElement).querySelector("figcaption")?.textContent || "") +
    "*\n\n",
});
export function pageMarkdown(page: Page) {
  return `# ${page.title}\n\n${markdown.turndown(generateHTML(page.content, extensions))}\n`;
}
export async function exportWorkspace(data: Workspace) {
  const zip = new JSZip();
  zip.file("workspace.json", JSON.stringify(data, null, 2));
  for (const page of data.pages) {
    zip.file(`pages/${page.id}.md`, pageMarkdown(page));
  }
  for (const attachment of data.attachments) {
    const blob = await getFile(attachment.id);
    if (!blob)
      throw new Error(
        `Cannot export: ${attachment.name} is missing. Your existing notes are unchanged.`,
      );
    zip.file(`attachments/${attachment.id}`, await blob.arrayBuffer());
  }
  download(
    await zip.generateAsync({ type: "blob" }),
    `slate-backup-${new Date().toISOString().slice(0, 10)}.zip`,
  );
}
export async function readBackup(
  file: File,
): Promise<{ data: Workspace; files: Map<string, Blob> }> {
  if (file.size > 200 * 1024 * 1024)
    throw new Error("Backup must be smaller than 200 MB.");
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("workspace.json");
  if (!entry)
    throw new Error("This is not a Slate backup. workspace.json is missing.");
  const raw = await entry.async("string");
  if (raw.length > 30 * 1024 * 1024)
    throw new Error("Workspace data is too large.");
  const data = normalize(validateWorkspace(JSON.parse(raw)) as Workspace);
  const files = new Map<string, Blob>();
  let total = 0;
  for (const attachment of data.attachments) {
    const item = zip.file(`attachments/${attachment.id}`);
    if (!item) throw new Error(`Missing attachment: ${attachment.name}`);
    const bytes = await item.async("uint8array");
    total += bytes.length;
    if (total > 200 * 1024 * 1024)
      throw new Error("Expanded backup exceeds 200 MB.");
    if (bytes.length !== attachment.size)
      throw new Error(`Attachment size mismatch: ${attachment.name}`);
    files.set(
      attachment.id,
      new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: attachment.type,
      }),
    );
  }
  return { data, files };
}
export async function restoreBackup(
  data: Workspace,
  files: Map<string, Blob>,
  revision: number,
) {
  const tx = (await db).transaction([...STORES, "files"], "readwrite");
  const old = (await tx.objectStore("workspace").get("main")) as
    | Meta
    | undefined;
  if ((old?.revision || 0) !== revision) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(
      "Another tab changed your workspace. Reload before restoring.",
    );
  }
  for (const name of ["files", "pages", "versions", "attachText"] as const)
    void tx.objectStore(name).clear();
  for (const [id, blob] of files) void tx.objectStore("files").put(blob, id);
  for (const p of data.pages) {
    void tx
      .objectStore("pages")
      .put({ content: p.content, plainText: p.plainText }, p.id);
    void tx.objectStore("versions").put(p.versions, p.id);
  }
  for (const a of data.attachments)
    void tx.objectStore("attachText").put(a.text, a.id);
  void tx
    .objectStore("workspace")
    .put(
      { data: metaOf(data), revision: revision + 1, split: true } as Meta,
      "main",
    );
  await tx.done;
  remember(data);
  return revision + 1;
}
/** True when a ZIP is a Slate backup or page pack (it has workspace.json). */
export async function isSlateZip(file: File) {
  try {
    return !!(await JSZip.loadAsync(file)).file("workspace.json");
  } catch {
    return false;
  }
}
