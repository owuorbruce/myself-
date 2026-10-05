import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline,
  Highlighter,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Table,
  Minus,
  Link,
  Undo2,
  Redo2,
  Plus,
  BookOpen,
  PanelRight,
  Paperclip,
} from "lucide-react";
import { extensions } from "./extensions";
import { plain, type Page, type Workspace } from "./types";
const slashCommands = [
  ["Text", "A plain paragraph", "text"],
  ["Heading 1", "A large section heading", "h1"],
  ["Heading 2", "A section heading", "h2"],
  ["Heading 3", "A small heading", "h3"],
  ["Bullet list", "A list of ideas", "bullet"],
  ["Numbered list", "Step by step", "ordered"],
  ["Checklist", "Keep track of progress", "task"],
  ["Quote", "A passage worth saving", "quote"],
  ["Callout", "Make something stand out", "note"],
  ["Exam marker", "Collect this in Study mode", "exam"],
  ["Definition", "Save an important concept", "definition"],
  ["Decision", "Record a project decision", "decision"],
  ["Code block", "For code and technical notes", "code"],
  ["Table", "Organize in rows and columns", "table"],
  ["Divider", "Separate sections", "divider"],
];
export default function NoteEditor({
  page,
  data,
  onChange,
  onSelect,
  onCard,
  onTask,
  onFile,
  onAI,
  onLink,
  onOutline,
}: {
  page: Page;
  data: Workspace;
  onChange: (content: Page["content"], plain: string) => void;
  onSelect: (text: string) => void;
  onCard: (text: string) => void;
  onTask: (text: string) => void;
  onFile: () => void;
  onAI: () => void;
  onLink: () => void;
  onOutline: () => void;
}) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const select = useRef(onSelect);
  select.current = onSelect;
  const [slash, setSlash] = useState<{
    query: string;
    from: number;
    to: number;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const editor = useEditor(
    {
      extensions: [
        ...extensions,
        Placeholder.configure({
          placeholder: "Write something, or type / for commands…",
        }),
      ],
      content: page.content,
      editorProps: {
        attributes: {
          class: "note-content",
          "aria-label": "Note content",
          spellcheck: "true",
        },
        handleKeyDown: (_view, event) => keyHandler.current(event),
        handleClick: (_view, _pos, event) => {
          const id = (event.target as HTMLElement)
            .closest("[data-page-link]")
            ?.getAttribute("data-page-link");
          if (id) {
            event.preventDefault();
            window.dispatchEvent(
              new CustomEvent("slate-open-page", { detail: id }),
            );
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        callback.current(editor.getJSON(), editor.getText());
        const { from, $from } = editor.state.selection;
        const text = $from.parent.textContent;
        const m = text.match(/^\/([^\n]*)$/);
        if (m) {
          setSlash({ query: m[1], from: from - text.length, to: from });
          setIndex(0);
        } else setSlash(null);
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection;
        select.current(editor.state.doc.textBetween(from, to, "\n"));
      },
    },
    [page.id],
  );
  useEffect(() => {
    if (
      editor &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(page.content)
    )
      editor.commands.setContent(page.content, { emitUpdate: false });
  }, [page.content, editor]);
  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (editor && detail.pageId === page.id)
        editor.chain().focus().insertContent(detail.content).run();
    };
    window.addEventListener("slate-insert", handle);
    return () => window.removeEventListener("slate-insert", handle);
  }, [editor, page.id]);
  const filtered = slashCommands.filter((c) =>
    (c[0] + " " + c[1])
      .toLowerCase()
      .includes(slash?.query.toLowerCase() || ""),
  );
  function command(type: string) {
    if (!editor) return;
    let chain = editor.chain().focus();
    if (slash) chain = chain.deleteRange({ from: slash.from, to: slash.to });
    switch (type) {
      case "text":
        chain.setParagraph().run();
        break;
      case "h1":
        chain.toggleHeading({ level: 1 }).run();
        break;
      case "h2":
        chain.toggleHeading({ level: 2 }).run();
        break;
      case "h3":
        chain.toggleHeading({ level: 3 }).run();
        break;
      case "bullet":
        chain.toggleBulletList().run();
        break;
      case "ordered":
        chain.toggleOrderedList().run();
        break;
      case "task":
        chain.toggleTaskList().run();
        break;
      case "quote":
        chain.toggleBlockquote().run();
        break;
      case "code":
        chain.toggleCodeBlock().run();
        break;
      case "table":
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
      case "divider":
        chain.setHorizontalRule().run();
        break;
      default:
        chain
          .insertContent({
            type: "callout",
            attrs: { kind: type },
            content: [{ type: "paragraph" }],
          })
          .run();
    }
    setSlash(null);
  }
  keyHandler.current = (e) => {
    if (!slash) return false;
    if (e.key === "Escape") {
      setSlash(null);
      return true;
    }
    if (e.key === "ArrowDown") {
      setIndex((i) => (i + 1) % Math.max(1, filtered.length));
      return true;
    }
    if (e.key === "ArrowUp") {
      setIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
      return true;
    }
    if (e.key === "Enter" && filtered.length) {
      command(filtered[index % filtered.length][2]);
      return true;
    }
    return false;
  };
  if (!editor) return null;
  const tool = (
    title: string,
    Icon: typeof Bold,
    run: () => void,
    active = false,
  ) => (
    <button
      key={title}
      className={active ? "active" : ""}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon size={17} />
    </button>
  );
  return (
    <div
      className={
        "editor-wrap " + (data.settings.font === "serif" ? "serif" : "")
      }
    >
      <div className="formatbar">
        {tool("Undo", Undo2, () => {
          editor.chain().focus().undo().run();
        })}
        {tool("Redo", Redo2, () => {
          editor.chain().focus().redo().run();
        })}
        <span className="toolbar-separator" />
        <select
          aria-label="Block format"
          value={
            editor.isActive("heading", { level: 1 })
              ? "h1"
              : editor.isActive("heading", { level: 2 })
                ? "h2"
                : editor.isActive("heading", { level: 3 })
                  ? "h3"
                  : "text"
          }
          onChange={(e) => command(e.target.value)}
        >
          <option value="text">Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        {tool(
          "Bold",
          Bold,
          () => {
            editor.chain().focus().toggleBold().run();
          },
          editor.isActive("bold"),
        )}
        {tool(
          "Italic",
          Italic,
          () => {
            editor.chain().focus().toggleItalic().run();
          },
          editor.isActive("italic"),
        )}
        {tool(
          "Underline",
          Underline,
          () => {
            editor.chain().focus().toggleUnderline().run();
          },
          editor.isActive("underline"),
        )}
        {tool(
          "Highlight",
          Highlighter,
          () => {
            editor.chain().focus().toggleHighlight().run();
          },
          editor.isActive("highlight"),
        )}
        <span className="toolbar-separator" />
        {tool(
          "Bullet list",
          List,
          () => command("bullet"),
          editor.isActive("bulletList"),
        )}
        {tool(
          "Numbered list",
          ListOrdered,
          () => command("ordered"),
          editor.isActive("orderedList"),
        )}
        {tool(
          "Checklist",
          ListTodo,
          () => command("task"),
          editor.isActive("taskList"),
        )}
        {tool("Quote", Quote, () => command("quote"))}
        {tool("Code block", Code, () => command("code"))}
        {tool("Table", Table, () => command("table"))}
        {tool("Divider", Minus, () => command("divider"))}
        {tool("Link a page", Link, onLink)}
        {tool("Attach file", Paperclip, onFile)}
      </div>
      <div className="editor-body">
        <EditorContent editor={editor} />
        {slash && (
          <div className="slash-menu">
            <div className="menu-label">INSERT A BLOCK</div>
            {filtered.length ? (
              filtered.map((c, i) => (
                <button
                  key={c[2]}
                  className={i === index ? "selected" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => command(c[2])}
                >
                  <Plus size={16} />
                  <span>
                    <strong>{c[0]}</strong>
                    <small>{c[1]}</small>
                  </span>
                </button>
              ))
            ) : (
              <p>No matching blocks</p>
            )}
          </div>
        )}
      </div>
      <div className="editor-footer">
        <span>
          {plain(page.content).trim().split(/\s+/).filter(Boolean).length} words
        </span>
        <span>Type / for blocks</span>
        <button
          onClick={() => {
            const { from, to } = editor.state.selection;
            onCard(editor.state.doc.textBetween(from, to, "\n"));
          }}
        >
          <BookOpen size={15} /> Flashcard
        </button>
        <button
          onClick={() => {
            const { from, to } = editor.state.selection;
            onTask(editor.state.doc.textBetween(from, to, "\n"));
          }}
        >
          <ListTodo size={15} /> Task
        </button>
        <button onClick={onAI}>✦ Ask ChatGPT</button>
        <button aria-label="Page outline" onClick={onOutline}>
          <PanelRight size={16} />
        </button>
      </div>
      {editor.isActive("table") && (
        <div className="table-tools">
          <button onClick={() => editor.chain().focus().addRowAfter().run()}>
            Add row
          </button>
          <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
            Add column
          </button>
          <button onClick={() => editor.chain().focus().deleteRow().run()}>
            Delete row
          </button>
          <button onClick={() => editor.chain().focus().deleteColumn().run()}>
            Delete column
          </button>
          <button onClick={() => editor.chain().focus().deleteTable().run()}>
            Remove table
          </button>
        </div>
      )}
    </div>
  );
}
