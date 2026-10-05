import type { JSONContent } from "@tiptap/react";
export type Page = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  content: JSONContent;
  plainText: string;
  tags: string[];
  favorite: boolean;
  trashed: boolean;
  createdAt: number;
  updatedAt: number;
  versions: { at: number; title: string; content: JSONContent }[];
};
export type Task = {
  id: string;
  pageId: string | null;
  text: string;
  due: string;
  done: boolean;
  priority: string;
};
export type Card = {
  id: string;
  pageId: string | null;
  question: string;
  answer: string;
  due: number;
  interval: number;
  ease?: number;
};
export type StudyKind = "reveal" | "blank" | "label" | "card" | "auto";
export type StudyItem = {
  id: string;
  pageId: string | null;
  kind: StudyKind;
  prompt: string;
  answer: string;
  ref?: { node: string; box?: string };
  right: number;
  wrong: number;
  due: number;
  interval: number;
  ease: number;
  last: number;
};
export type Study = { items: StudyItem[]; days: string[] };
export type Attachment = {
  id: string;
  pageId: string;
  name: string;
  type: string;
  size: number;
  text: string;
};
export type Field = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "checkbox" | "select" | "url";
  options?: string[];
};
export type Row = { id: string; values: Record<string, string | boolean> };
export type Collection = {
  id: string;
  name: string;
  fields: Field[];
  rows: Row[];
  view: "table" | "board" | "calendar" | "list" | "gallery";
};
export type Workspace = {
  schema: 1;
  pages: Page[];
  tasks: Task[];
  cards: Card[];
  attachments: Attachment[];
  collections: Collection[];
  study?: Study;
  deleted?: Record<string, number>;
  restored?: Record<string, number>;
  settings: {
    theme: "system" | "light" | "dark" | "sepia";
    font: "sans" | "serif";
    wide: boolean;
    ocr?: boolean;
  };
};
export type View =
  | "home"
  | "page"
  | "learn"
  | "tasks"
  | "study"
  | "collections"
  | "settings"
  | "trash";
export const uid = () => crypto.randomUUID();
export const textDoc = (text: string): JSONContent => ({
  type: "doc",
  content: text
    .split("\n")
    .map((t) => ({
      type: "paragraph",
      content: t ? [{ type: "text", text: t }] : [],
    })),
});
export const plain = (doc: JSONContent): string =>
  (doc.content || [])
    .map((n) =>
      n.type === "pageLink"
        ? String(n.attrs?.label || "")
        : n.type === "blank"
          ? String(n.attrs?.answer || "").split("|")[0]
          : n.type === "reveal"
            ? String(n.attrs?.question || "") + "\n" + plain(n)
            : n.type === "labelImage"
              ? ((n.attrs?.boxes as { answer: string }[]) || [])
                  .map((b) => b.answer.split("|")[0])
                  .join(", ")
              : n.text || plain(n),
    )
    .join(doc.type === "paragraph" || doc.type === "heading" ? "" : "\n");
export const newPage = (
  title = "Untitled",
  parentId: string | null = null,
  content: JSONContent = textDoc(""),
): Page => ({
  id: uid(),
  parentId,
  title,
  icon: "📄",
  content,
  plainText: plain(content),
  tags: [],
  favorite: false,
  trashed: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  versions: [],
});
const t = (text: string, bold = false): JSONContent =>
  bold ? { type: "text", text, marks: [{ type: "bold" }] } : { type: "text", text };
const para = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const gap = (answer: string): JSONContent => ({
  type: "blank",
  attrs: { id: uid(), answer },
});
const h2 = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2 },
  content: [t(text)],
});
export const EXAMPLE_TITLE = "Interactive notes: example";
/** A short page that shows off the interactive blocks. */
export function examplePage(parentId: string | null = null): Page {
  const content: JSONContent = {
    type: "doc",
    content: [
      para(
        t(
          "Notes on this page quiz you back. Press Teach me at the top to learn it one bite at a time, or try the blocks right here.",
        ),
      ),
      h2("Bone cells"),
      para(
        t("Osteoblasts", true),
        t(" build new bone matrix, while "),
        gap("osteoclasts|osteoclast"),
        t(" break bone down to release calcium into the blood."),
      ),
      para(
        t("Osteocytes", true),
        t(" are mature bone cells that sit in small spaces called "),
        gap("lacunae|lacuna"),
        t("."),
      ),
      {
        type: "reveal",
        attrs: {
          id: uid(),
          question: "Which hormone raises blood calcium by activating osteoclasts?",
        },
        content: [para(t("Parathyroid hormone (PTH), from the parathyroid glands."))],
      },
      h2("Make your own"),
      {
        type: "bulletList",
        content: [
          "Type / and pick Tap to Learn, Fill in the blank, or Label an image.",
          "Select a word and press the blank button in the toolbar to turn it into a gap.",
          "Label an image: drop in a lab slide, drag boxes over its labels, and quiz yourself.",
          "Bold your key terms. Teach me turns them into questions for you.",
        ].map((text) => ({ type: "listItem", content: [para(t(text))] })),
      },
    ],
  };
  const page = newPage(EXAMPLE_TITLE, parentId, content);
  page.icon = "🎯";
  return page;
}
export function seed(): Workspace {
  const welcome = newPage("Start here", null, {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "A little space for your big ideas." }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Welcome to Slate. Write freely, organize as you go, and keep a copy of everything that matters.",
          },
        ],
      },
      {
        type: "callout",
        attrs: { kind: "note" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Your workspace is stored on this device. Export a backup in Settings before changing browsers or clearing site data.",
              },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Make yourself at home" }],
      },
      {
        type: "bulletList",
        content: [
          "Create a page with the + button or Ctrl / Cmd + N.",
          "Type / in the editor for headings, checklists, tables, quizzes, and exam markers.",
          "Open “Interactive notes: example” in School and press Teach me.",
          "Link pages, attach readings, and turn key concepts into flashcards.",
          "Use Ask ChatGPT to copy a prompt with your notes into ChatGPT.",
        ].map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Ready for a fresh start?" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "School and Projects are empty starter pages. Rename them, move them, or create your own structure. This page can go in the trash whenever you’re ready.",
          },
        ],
      },
    ],
  });
  welcome.icon = "✦";
  welcome.favorite = true;
  const school = newPage("School");
  school.icon = "📚";
  const projects = newPage("Projects");
  projects.icon = "🛠️";
  const inbox = newPage("Inbox");
  inbox.icon = "📥";
  const example = examplePage(school.id);
  return {
    schema: 1,
    pages: [welcome, school, example, projects, inbox],
    tasks: [],
    cards: [],
    attachments: [],
    collections: [],
    study: { items: [], days: [] },
    settings: { theme: "system", font: "sans", wide: false },
  };
}
