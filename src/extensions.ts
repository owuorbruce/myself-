import { Node, mergeAttributes, wrappingInputRule } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Blockquote from "@tiptap/extension-blockquote";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
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
/**
 * Toggle: a one-line summary with content that collapses underneath, like
 * Notion's. Built on TipTap's details nodes; `id` keys its Study history.
 * Whether a toggle is open is kept per device, not in the note.
 */
export const Toggle = Details.extend({
  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-id") || "",
        renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
      },
    };
  },
});
export const ToggleSummary = DetailsSummary;
export const ToggleContent = DetailsContent;
/** Quotes start with `" ` (as in Notion), so `> ` can make a toggle. */
export const Quote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*"\s$/, type: this.type })];
  },
});
/** Fill-in-the-blank: an inline gap with an accepted answer ("a|b"). */
export const Blank = Node.create({
  name: "blank",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: "", rendered: false },
      answer: { default: "", rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-blank]",
        getAttrs: (el) => ({
          id: el.getAttribute("data-id") || "",
          answer: el.getAttribute("data-answer") || el.textContent || "",
        }),
      },
    ];
  },
  renderText({ node }) {
    return `{{${node.attrs.answer}}}`;
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-blank": "",
        "data-id": node.attrs.id,
        "data-answer": node.attrs.answer,
        class: "blank-static",
      },
      String(node.attrs.answer || "").split("|")[0],
    ];
  },
});
type Box = { id: string; x: number; y: number; w: number; h: number; answer: string };
/** An image with boxes to label, like a lab practical slide. */
export const LabelImage = Node.create({
  name: "labelImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: "", rendered: false },
      src: { default: "", rendered: false },
      boxes: { default: [], rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-label-image]",
        getAttrs: (el) => {
          let boxes: Box[] = [];
          try {
            boxes = JSON.parse(el.getAttribute("data-boxes") || "[]");
          } catch {
            boxes = [];
          }
          return {
            id: el.getAttribute("data-id") || "",
            src: el.querySelector("img")?.getAttribute("src") || "",
            boxes,
          };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const boxes = (node.attrs.boxes || []) as Box[];
    return [
      "figure",
      {
        "data-label-image": "",
        "data-id": node.attrs.id,
        "data-boxes": JSON.stringify(boxes),
        class: "label-static",
      },
      [
        "div",
        { class: "label-frame" },
        ["img", { src: node.attrs.src, alt: "Labelled diagram" }],
        ...boxes.map(
          (b): DOMOutputSpec => [
            "span",
            {
              class: "label-tag",
              style: `left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%`,
            },
            b.answer.split("|")[0],
          ],
        ),
      ],
      [
        "figcaption",
        {},
        "Labels: " + boxes.map((b) => b.answer.split("|")[0]).join(", "),
      ],
    ];
  },
});
export const extensions = [
  StarterKit.configure({
    link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
    blockquote: false,
  }),
  Quote,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true } }),
  Highlight,
  Image.configure({ allowBase64: true }),
  Callout,
  PageLink,
  Toggle,
  ToggleSummary,
  ToggleContent,
  Blank,
  LabelImage,
];
