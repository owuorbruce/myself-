import type { JSONContent } from "@tiptap/react";
function inline(text: string): JSONContent[] {
  const parts: JSONContent[] = [];
  const regex =
    /(\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  for (const m of text.matchAll(regex)) {
    if (m.index! > last)
      parts.push({ type: "text", text: text.slice(last, m.index) });
    parts.push(
      m[2]
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
  for (const line of lines) {
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
