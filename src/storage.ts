import { openDB } from "idb";
import JSZip from "jszip";
import TurndownService from "turndown";
import { generateHTML } from "@tiptap/core";
import { extensions } from "./extensions";
import { seed, type Workspace, type Page } from "./types";
import { validateWorkspace } from "./validation.mjs";
const db = openDB("slate-workspace", 1, {
  upgrade(db) {
    db.createObjectStore("workspace");
    db.createObjectStore("files");
  },
});
export async function load() {
  const saved = await (await db).get("workspace", "main");
  return saved || { revision: 0, data: seed() };
}
export async function save(data: Workspace, revision: number) {
  const tx = (await db).transaction("workspace", "readwrite");
  const previous = await tx.store.get("main");
  if ((previous?.revision || 0) !== revision) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(
      "This workspace changed in another tab. Export your unsaved work, then reload this tab.",
    );
  }
  await tx.store.put({ revision: revision + 1, data }, "main");
  await tx.done;
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
  const data = validateWorkspace(JSON.parse(raw)) as Workspace;
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
  const tx = (await db).transaction(["workspace", "files"], "readwrite");
  const old = await tx.objectStore("workspace").get("main");
  if ((old?.revision || 0) !== revision) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(
      "Another tab changed your workspace. Reload before restoring.",
    );
  }
  await tx.objectStore("files").clear();
  for (const [id, blob] of files) await tx.objectStore("files").put(blob, id);
  await tx
    .objectStore("workspace")
    .put({ data, revision: revision + 1 }, "main");
  await tx.done;
  return revision + 1;
}
