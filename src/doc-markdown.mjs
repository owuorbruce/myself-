// A page's content as Markdown, without a browser (for AI tools and the
// remote MCP worker). Slate's Markdown importer reads this back.

function inline(nodes = []) {
  return nodes.map((n) => {
    if (n.type === "hardBreak") return "\n";
    if (n.type === "pageLink") return `[[${n.attrs?.label || "page"}]]`;
    if (n.type === "blank") return `{{${n.attrs?.answer || ""}}}`;
    if (n.type !== "text") return inline(n.content);
    let text = n.text || "";
    const marks = new Set((n.marks || []).map((m) => m.type));
    if (!text.trim()) return text;
    if (marks.has("code")) text = "`" + text + "`";
    else {
      if (marks.has("strike")) text = `~~${text}~~`;
      if (marks.has("italic")) text = `*${text}*`;
      if (marks.has("bold")) text = `**${text}**`;
    }
    const link = (n.marks || []).find((m) => m.type === "link")?.attrs?.href;
    return link ? `[${text}](${link})` : text;
  }).join("");
}

const indent = (text, pad) => text.split("\n").map((l) => (l ? pad + l : l)).join("\n");
const quote = (text) => text.split("\n").map((l) => (l ? "> " + l : ">")).join("\n");

function list(node, depth, marker) {
  return (node.content || []).map((item, i) => {
    const [first, ...rest] = item.content || [];
    const prefix = node.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] `
      : marker === "ordered" ? `${i + 1}. ` : "- ";
    const head = prefix + (first?.type === "paragraph" ? inline(first.content) : blocks([first].filter(Boolean), depth + 1));
    const tail = rest.map((b) => indent(blocks([b], depth + 1), "    ")).join("\n");
    return tail ? head + "\n" + tail : head;
  }).join("\n");
}

function table(node) {
  const rows = (node.content || []).map((row) =>
    (row.content || []).map((cell) => (cell.content || []).map((b) => inline(b.content)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => "| " + Array.from({ length: width }, (_, i) => r[i] || "").join(" | ") + " |";
  return [line(rows[0]), "| " + Array(width).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
}

function block(n, depth) {
  switch (n.type) {
    case "paragraph": return inline(n.content);
    case "heading": return "#".repeat(Math.min(6, n.attrs?.level || 1)) + " " + inline(n.content);
    case "bulletList": return list(n, depth, "bullet");
    case "orderedList": return list(n, depth, "ordered");
    case "taskList": return list(n, depth, "task");
    case "blockquote": return quote(blocks(n.content, depth));
    case "callout": return `> [!${String(n.attrs?.kind || "note").toUpperCase()}]\n` + quote(blocks(n.content, depth));
    case "codeBlock": return "```" + (n.attrs?.language || "") + "\n" + inline(n.content) + "\n```";
    case "horizontalRule": return "---";
    case "table": return table(n);
    case "image": return `*(image${n.attrs?.alt ? ": " + n.attrs.alt : ""})*`;
    case "labelImage":
      return `*(labelled image: ${((n.attrs?.boxes) || []).map((b) => String(b.answer || "").split("|")[0]).join(", ")})*`;
    case "details": {
      const summary = (n.content || []).find((c) => c.type === "detailsSummary");
      const body = (n.content || []).find((c) => c.type === "detailsContent");
      const title = inline(summary?.content).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
      return `<details>\n<summary>${title}</summary>\n\n${blocks(body?.content, depth + 1)}\n\n</details>`;
    }
    case "reveal":
      return `<details>\n<summary>${String(n.attrs?.question || "")}</summary>\n\n${blocks(n.content, depth + 1)}\n\n</details>`;
    default: return n.content ? blocks(n.content, depth) : "";
  }
}

function blocks(nodes = [], depth = 0) {
  return nodes.map((n) => block(n, depth)).filter((s) => s !== "").join("\n\n");
}

export function docToMarkdown(doc) {
  return blocks(doc?.content || []).replace(/\n{3,}/g, "\n\n").trim();
}

/** True when a page holds images or labelled diagrams, which Markdown can't carry. */
export function hasPictures(doc) {
  let found = false;
  const walk = (n) => {
    if (found || !n) return;
    if (n.type === "image" || n.type === "labelImage") found = true;
    else n.content?.forEach(walk);
  };
  walk(doc);
  return found;
}
