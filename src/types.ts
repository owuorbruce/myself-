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
};
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
  settings: {
    theme: "light" | "dark" | "sepia";
    font: "sans" | "serif";
    wide: boolean;
  };
};
export type View =
  "home" | "page" | "tasks" | "study" | "collections" | "settings" | "trash";
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
      n.type === "pageLink" ? String(n.attrs?.label || "") : n.text || plain(n),
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
          "Type / in the editor for headings, checklists, tables, and exam markers.",
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
  return {
    schema: 1,
    pages: [welcome, school, projects, inbox],
    tasks: [],
    cards: [],
    attachments: [],
    collections: [],
    settings: { theme: "light", font: "sans", wide: false },
  };
}
