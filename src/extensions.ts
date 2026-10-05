import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { kind: { default: "note" } };
  },
  parseHTML() {
    return [
      {
        tag: "aside[data-kind]",
        getAttrs: (el) => ({ kind: el.getAttribute("data-kind") }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes({ "data-kind": HTMLAttributes.kind }, HTMLAttributes),
      0,
    ];
  },
});
export const PageLink = Node.create({
  name: "pageLink",
  priority: 1000,
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "a[data-page-link]" }, { tag: "span[data-page-link]" }];
  },
  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      {
        href: "#page-" + HTMLAttributes.id,
        "data-page-link": HTMLAttributes.id,
        "data-label": HTMLAttributes.label,
        class: "page-link",
      },
      `↗ ${HTMLAttributes.label}`,
    ];
  },
});
export const extensions = [
  StarterKit.configure({
    link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Highlight,
  Image.configure({ allowBase64: true }),
  Callout,
  PageLink,
];
