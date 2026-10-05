import type { JSONContent } from "@tiptap/react";
import { uid } from "./types";
function inline(text: string): JSONContent[] {
  const parts: JSONContent[] = [];
  const regex =
    /(\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\{\{([^{}]+)\}\})/g;
  let last = 0;
  for (const m of text.matchAll(regex)) {
    if (m.index! > last)
      parts.push({ type: "text", text: text.slice(last, m.index) });
    parts.push(
      m[7]
        ? { type: "blank", attrs: { id: uid(), answer: m[7].trim() } }
        : m[2]
        ? { type: "text", text: m[2], marks: [{ type: "bold" }] }
        : m[3]
          ? { type: "text", text: m[3], marks: [{ type: "code" }] }
          : m[4]
            ? { type: "text", text: m[4], marks: [{ type: "italic" }] }
            : {
                type: "text",
                text: m[5],
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: m[6],
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                  },
                ],
              },
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
export function parseMarkdown(text: string): JSONContent {
  const blocks: JSONContent[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let code: string[] | null = null;
  let language = "";
  let table: string[][] | null = null;
  const endTable = () => {
    if (!table) return;
    const rows = table;
    table = null;
    const width = Math.max(...rows.map((r) => r.length));
    blocks.push({
      type: "table",
      content: rows.map((r, i) => ({
        type: "tableRow",
        content: Array.from({ length: width }, (_, j) => ({
          type: i === 0 ? "tableHeader" : "tableCell",
          content: [{ type: "paragraph", content: inline(r[j] || "") }],
        })),
      })),
    });
  };
  for (const line of lines) {
    if (!code && /^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, "|"));
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      (table ||= []).push(cells);
      continue;
    }
    endTable();
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({
          type: "codeBlock",
          attrs: { language },
          content: code.length ? [{ type: "text", text: code.join("\n") }] : [],
        });
        code = null;
      } else {
        code = [];
        language = line.slice(3).trim();
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: inline(heading[2]),
      });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ type: "horizontalRule" });
      continue;
    }
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (task || bullet || ordered) {
      const listType = task
        ? "taskList"
        : bullet
          ? "bulletList"
          : "orderedList";
      const item: JSONContent = {
        type: task ? "taskItem" : "listItem",
        ...(task ? { attrs: { checked: task[1].toLowerCase() === "x" } } : {}),
        content: [
          {
            type: "paragraph",
            content: inline(task ? task[2] : bullet ? bullet[1] : ordered![1]),
          },
        ],
      };
      const prev = blocks[blocks.length - 1];
      if (prev?.type === listType) prev.content!.push(item);
      else blocks.push({ type: listType, content: [item] });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: inline(line.slice(2)) }],
      });
      continue;
    }
    blocks.push({ type: "paragraph", content: inline(line) });
  }
  endTable();
  if (code)
    blocks.push({
      type: "codeBlock",
      attrs: { language },
      content: code.length ? [{ type: "text", text: code.join("\n") }] : [],
    });
  return {
    type: "doc",
    content: blocks.length ? blocks : [{ type: "paragraph" }],
  };
}

/*
 * Toggles. Notion exports a toggle as a bullet whose children are indented
 * paragraphs (Markdown has no toggle), and some tools write <details>.
 * A toggle that holds other toggles becomes a section heading; a toggle
 * that holds an answer becomes a Tap to Learn block.
 */
type Segment =
  | { kind: "text"; lines: string[] }
  | { kind: "toggle"; title: string; children: Segment[] };

const indentOf = (line: string) => {
  const lead = line.match(/^[ \t]*/)![0];
  return lead.replace(/\t/g, "    ").length;
};
const isBlank = (line: string) => !line.trim();
const listLine = /^\s*(?:[-*+]|\d+\.)\s+/;

function dedent(lines: string[]) {
  const sizes = lines.filter((l) => !isBlank(l)).map(indentOf);
  const cut = sizes.length ? Math.min(...sizes) : 0;
  return lines.map((l) => {
    let out = l.replace(/\t/g, "    ");
    let n = 0;
    while (n < cut && out[n] === " ") n++;
    return out.slice(n);
  });
}

function segments(lines: string[], depth = 0): Segment[] {
  const out: Segment[] = [];
  const text = (line: string) => {
    const last = out[out.length - 1];
    if (last?.kind === "text") last.lines.push(line);
    else out.push({ kind: "text", lines: [line] });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // <details><summary>Title</summary> … </details>
    if (/^\s*<details[^>]*>\s*$/i.test(line) && depth < 12) {
      let title = "";
      const body: string[] = [];
      let level = 1;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (/^\s*<details[^>]*>\s*$/i.test(l)) level++;
        if (/^\s*<\/details>\s*$/i.test(l)) {
          level--;
          if (level === 0) break;
        }
        const summary = l.match(/^\s*<summary>(.*)<\/summary>\s*$/i);
        if (summary && level === 1 && !title) title = summary[1];
        else body.push(l);
      }
      out.push({
        kind: "toggle",
        title,
        children: segments(dedent(body), depth + 1),
      });
      i = j;
      continue;
    }
    // A bullet with indented, non-list children is a Notion toggle.
    const bullet = line.match(/^(\s*)[-*+]\s+(?!\[[ xX]\]\s)(.+)$/);
    if (bullet && depth < 12) {
      const base = indentOf(line);
      const children: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (!isBlank(l) && indentOf(l) <= base) break;
        children.push(l);
      }
      while (children.length && isBlank(children[children.length - 1]))
        children.pop();
      const inner = dedent(children);
      const hasProse = inner.some(
        (l) => !isBlank(l) && !listLine.test(l) && indentOf(l) === 0,
      );
      const nested = children.some((l) => !isBlank(l))
        ? segments(inner, depth + 1)
        : [];
      if (hasProse || nested.some((n) => n.kind === "toggle")) {
        out.push({ kind: "toggle", title: bullet[2], children: nested });
        i = j - 1;
        continue;
      }
    }
    text(line);
  }
  return out;
}

const cleanTitle = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/, "")
    .trim();

function convert(list: Segment[], depth: number): JSONContent[] {
  const nodes: JSONContent[] = [];
  for (const s of list) {
    if (s.kind === "text") {
      const doc = parseMarkdown(s.lines.join("\n"));
      nodes.push(
        ...(doc.content || []).filter(
          (n) => !(n.type === "paragraph" && !n.content?.length),
        ),
      );
      continue;
    }
    const title = cleanTitle(s.title) || "Question";
    if (s.children.some((c) => c.kind === "toggle")) {
      nodes.push({
        type: "heading",
        attrs: { level: Math.min(3, 2 + depth) },
        content: [{ type: "text", text: title }],
      });
      nodes.push(...convert(s.children, depth + 1));
    } else {
      const answer = convert(s.children, depth + 1);
      nodes.push({
        type: "reveal",
        attrs: { id: uid(), question: title },
        content: answer.length ? answer : [{ type: "paragraph" }],
      });
    }
  }
  return nodes;
}

/** Markdown with toggles turned into sections and Tap to Learn blocks. */
export function parseRich(text: string): JSONContent {
  const lines = text
    .replace(/\r\n/g, "\n")
    // Put <details> tags on their own lines so they can be matched.
    .replace(/\s*<details[^>]*>\s*/gi, "\n<details>\n")
    .replace(/\s*<summary>([\s\S]*?)<\/summary>\s*/gi, (_m, t: string) =>
      "\n<summary>" + t.replace(/\s+/g, " ").trim() + "</summary>\n",
    )
    .replace(/\s*<\/details>\s*/gi, "\n</details>\n")
    .split("\n");
  const content = convert(segments(lines), 0);
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}
