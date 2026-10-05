import JSZip from "jszip";
import type { JSONContent } from "@tiptap/react";
import { parseMarkdown, parseRich } from "./markdown";
import {
  newPage,
  plain,
  uid,
  type Attachment,
  type Collection,
  type Page,
} from "./types";

/** Imports a Notion "Markdown & CSV" export ZIP. */
export type NotionImport = {
  pages: Page[];
  collections: Collection[];
  files: { attachment: Attachment; blob: Blob }[];
  skipped: number;
};

const HEX = /\s+([0-9a-f]{32})$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};
const mime = (name: string) =>
  MIME[name.split(".").pop()!.toLowerCase()] || "application/octet-stream";
const base = (path: string) => path.split("/").pop() || path;
const dir = (path: string) => path.split("/").slice(0, -1).join("/");
const titleOf = (name: string) =>
  name.replace(/\.(md|csv)$/i, "").replace(/_all$/, "").replace(HEX, "").trim() ||
  "Untitled";

function resolve(from: string, href: string) {
  let target: string;
  try {
    target = decodeURIComponent(href.split("#")[0].split("?")[0]);
  } catch {
    target = href;
  }
  const parts = (from ? from.split("/") : []).concat(target.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function entriesOf(zip: JSZip, depth = 0): Promise<Map<string, JSZip.JSZipObject>> {
  const map = new Map<string, JSZip.JSZipObject>();
  const nested: JSZip.JSZipObject[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir || path.startsWith("__MACOSX/")) return;
    if (/\.zip$/i.test(path)) nested.push(entry);
    else map.set(path.replace(/^\.\//, ""), entry);
  });
  // Large Notion exports wrap the real export in another ZIP.
  if (depth < 2)
    for (const n of nested) {
      const inner = await JSZip.loadAsync(await n.async("uint8array"));
      for (const [k, v] of await entriesOf(inner, depth + 1)) map.set(k, v);
    }
  return map;
}

async function dataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function importNotion(
  file: File,
  progress: (message: string) => void = () => {},
): Promise<NotionImport> {
  if (file.size > 200 * 1024 * 1024)
    throw new Error("The export must be smaller than 200 MB.");
  const entries = await entriesOf(await JSZip.loadAsync(file));
  const paths = [...entries.keys()];
  if (paths.some((p) => /(^|\/)run-slate\.mjs$/.test(p)))
    throw new Error(
      "That's the Slate app download, not notes. Pick your Notion export or a Slate file.",
    );
  const markdown = paths.filter((p) => /\.md$/i.test(p));
  const csvs = paths.filter((p) => /\.csv$/i.test(p));
  if (!markdown.length && !csvs.length)
    throw new Error(
      "This doesn't look like a Notion export. In Notion choose Export → Markdown & CSV.",
    );
  // Every page or database gets a Slate id, keyed by its path without
  // the extension. A page's children live in a folder with that name.
  const ids = new Map<string, string>();
  const pages: Page[] = [];
  const collections: Collection[] = [];
  const files: NotionImport["files"] = [];
  let skipped = 0;
  for (const p of markdown) ids.set(p.replace(/\.md$/i, ""), uid());
  const databases = new Map<string, string>();
  for (const p of csvs) {
    const key = p.replace(/\.csv$/i, "").replace(/_all$/, "");
    // Prefer the _all.csv file, which holds every row.
    if (!databases.has(key) || /_all\.csv$/i.test(p)) databases.set(key, p);
  }
  for (const key of databases.keys()) if (!ids.has(key)) ids.set(key, uid());
  // Folders whose page isn't in the export still need a parent page.
  const folders = new Set<string>();
  for (const p of [...markdown, ...csvs]) {
    let d = dir(p);
    while (d) {
      folders.add(d);
      d = dir(d);
    }
  }
  const parentOf = (path: string) => {
    const d = dir(path);
    return d && ids.has(d) ? ids.get(d)! : null;
  };
  // Skip wrapper folders (like "Private & Shared") that hold everything.
  const skip = new Set<string>();
  let prefix = "";
  for (;;) {
    const first = new Set(
      [...markdown, ...csvs].map((p) => p.slice(prefix.length).split("/")[0]),
    );
    const only = [...first][0];
    const folder = prefix + only;
    if (first.size !== 1 || ids.has(folder) || !folders.has(folder)) break;
    skip.add(folder);
    prefix = folder + "/";
  }
  const folderOf = new Map<string, string>();
  for (const f of [...folders].sort()) {
    if (ids.has(f) || skip.has(f)) continue;
    const page = newPage(titleOf(base(f)), null);
    ids.set(f, page.id);
    folderOf.set(page.id, f);
    page.icon = "📁";
    pages.push(page);
  }
  for (const page of pages) page.parentId = parentOf(folderOf.get(page.id)!);

  let done = 0;
  for (const path of markdown) {
    if (++done % 10 === 0) progress(`Importing page ${done} of ${markdown.length}…`);
    const id = ids.get(path.replace(/\.md$/i, ""))!;
    const here = dir(path);
    const text = await entries.get(path)!.async("string");
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    if (/^#\s+/.test(lines[0] || "")) lines.shift();
    // Callouts come out as <aside> blocks. Turn them into quotes.
    let inAside = false;
    const images: JSONContent[] = [];
    const links: { id: string; label: string }[] = [];
    const attachedHere: { attachment: Attachment; target: string }[] = [];
    const out: string[] = [];
    for (let line of lines) {
      if (/^\s*<aside>\s*$/.test(line)) {
        inAside = true;
        continue;
      }
      if (/^\s*<\/aside>\s*$/.test(line)) {
        inAside = false;
        continue;
      }
      line = line.replace(/<\/?(span|div)[^>]*>/g, "");
      const lead = line.match(/^\s*/)![0];
      // An embedded slide saved as an HTML file: use the pictures inside it.
      const embed = line.match(/^\s*\[([^\]]*)\]\(([^)]+\.html?)\)\s*$/i);
      if (embed && !/^https?:/i.test(embed[2])) {
        const entry = entries.get(resolve(here, embed[2]));
        if (entry) {
          const html = await entry.async("string");
          const found = [
            ...html.matchAll(
              /data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/gi,
            ),
          ]
            .map((m) =>
              m[0].replace(/^data:image\/jpg;/i, "data:image/jpeg;"),
            )
            .filter((src, i, all) => all.indexOf(src) === i && src.length < 7e6)
            .slice(0, 4);
          if (found.length) {
            for (const src of found) {
              images.push({
                type: "image",
                attrs: { src, alt: embed[1] || base(embed[2]) },
              });
              out.push(`${lead}@@IMG${images.length - 1}@@`);
            }
            continue;
          }
        }
      }
      const image = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (image && !/^https?:/i.test(image[2])) {
        const target = resolve(here, image[2]);
        const entry = entries.get(target);
        if (entry && IMAGE.test(target)) {
          const blob = new Blob([await entry.async("arraybuffer")], {
            type: mime(target),
          });
          if (blob.size < 5 * 1024 * 1024) {
            images.push({
              type: "image",
              attrs: { src: await dataURL(blob), alt: image[1] || base(target) },
            });
            out.push(`${lead}@@IMG${images.length - 1}@@`);
            continue;
          }
        }
      }
      line = line.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (all, label, href) => {
        if (/^(https?:|mailto:)/i.test(href)) return all;
        const target = resolve(here, href);
        const pageKey = target.replace(/\.(md|csv)$/i, "").replace(/_all$/, "");
        if (ids.has(pageKey)) {
          links.push({ id: ids.get(pageKey)!, label: label || titleOf(base(target)) });
          return `@@LINK${links.length - 1}@@`;
        }
        const entry = entries.get(target);
        if (entry && !/\.(md|csv)$/i.test(target)) {
          const attachment: Attachment = {
            id: uid(),
            pageId: id,
            name: base(target),
            type: mime(target),
            size: 0,
            text: "",
          };
          attachedHere.push({ attachment, target });
          return label || base(target);
        }
        return label;
      });
      out.push(inAside ? "> " + line.replace(/^>\s?/, "") : line);
    }
    for (const { attachment: a, target } of attachedHere) {
      const bytes = await entries.get(target)!.async("arraybuffer");
      if (bytes.byteLength > 25 * 1024 * 1024) {
        skipped++;
        continue;
      }
      a.size = bytes.byteLength;
      if (/^text\//.test(a.type))
        a.text = new TextDecoder().decode(bytes).slice(0, 1000000);
      files.push({ attachment: a, blob: new Blob([bytes], { type: a.type }) });
    }
    const doc = parseRich(out.join("\n"));
    const fill = (n: JSONContent): JSONContent[] => {
      if (n.type === "paragraph" && n.content?.length === 1) {
        const m = (n.content[0].text || "").match(/^\s*@@IMG(\d+)@@\s*$/);
        if (m) return [images[Number(m[1])]];
      }
      if (n.type === "text" && n.text && /@@LINK\d+@@/.test(n.text)) {
        return n.text
          .split(/(@@LINK\d+@@)/)
          .filter(Boolean)
          .map((part) => {
            const m = part.match(/^@@LINK(\d+)@@$/);
            return m
              ? { type: "pageLink", attrs: links[Number(m[1])] }
              : { ...n, text: part };
          });
      }
      return [n.content ? { ...n, content: n.content.flatMap(fill) } : n];
    };
    const content = { ...doc, content: (doc.content || []).flatMap(fill) };
    const page = newPage(titleOf(base(path)), parentOf(path), content);
    page.id = id;
    page.plainText = plain(content);
    page.icon = "📝";
    pages.push(page);
  }

  for (const [key, path] of databases) {
    const id = ids.get(key)!;
    const rows = parseCSV((await entries.get(path)!.async("string")).replace(/^﻿/, ""));
    if (!pages.some((p) => p.id === id)) {
      const page = newPage(titleOf(base(key)), parentOf(path), parseMarkdown(
        "Imported from a Notion database. Its rows are the pages inside this one, and the table is in Collections.",
      ));
      page.id = id;
      page.icon = "🗂️";
      page.plainText = plain(page.content);
      pages.push(page);
    }
    if (rows.length < 1) continue;
    const header = rows[0].map((h, i) => h.trim() || "Column " + (i + 1));
    const fields = header.map((name) => ({ id: uid().slice(0, 8), name, type: "text" as const }));
    collections.push({
      id: uid(),
      name: titleOf(base(key)),
      fields,
      view: "table",
      rows: rows.slice(1, 5001).map((r) => ({
        id: uid(),
        values: Object.fromEntries(fields.map((f, i) => [f.id, r[i] || ""])),
      })),
    });
  }
  // Database row pages sit in the database's folder; parentOf found them.
  return { pages, collections, files, skipped };
}
