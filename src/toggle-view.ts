import { InputRule, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Toggle, ToggleContent } from "./extensions";
import { uid } from "./types";

/** Which toggles are open is remembered on this device only. */
const OPEN_KEY = "slate-open-toggles";
let openIds: Set<string> | null = null;
function opened() {
  if (!openIds) {
    try {
      openIds = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"));
    } catch {
      openIds = new Set();
    }
  }
  return openIds;
}
export function isOpen(id: string) {
  return !!id && opened().has(id);
}
export function setOpen(id: string, open: boolean) {
  if (!id) return;
  const ids = opened();
  ids.delete(id);
  if (open) ids.add(id);
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...ids].slice(-2000)));
  } catch {
    /* storage unavailable: open state lasts for this session */
  }
}

/**
 * Turn the paragraph holding the cursor into a toggle. Its text becomes the
 * summary and the cursor stays at the end of it. False when a toggle can't go here.
 */
function paragraphToToggle(state: EditorState, tr: Transaction, from: number) {
  const $from = tr.doc.resolve(from);
  const paragraph = $from.parent;
  if (paragraph.type.name !== "paragraph" || $from.depth < 1) return false;
  const { details, detailsSummary, detailsContent, paragraph: p } = state.schema.nodes;
  const index = $from.index($from.depth - 1);
  if (!$from.node($from.depth - 1).canReplaceWith(index, index + 1, details)) return false;
  const text: { text: string; marks: readonly import("@tiptap/pm/model").Mark[] }[] = [];
  paragraph.forEach((child) => {
    if (child.isText) text.push({ text: child.text || "", marks: child.marks });
  });
  const id = uid();
  const node = details.create({ id }, [
    detailsSummary.create(null, text.filter((t) => t.text).map((t) => state.schema.text(t.text, t.marks))),
    detailsContent.create(null, p.create()),
  ]);
  const start = $from.before();
  tr.replaceWith(start, start + paragraph.nodeSize, node);
  const summaryEnd = start + 2 + node.child(0).content.size;
  tr.setSelection(TextSelection.create(tr.doc, summaryEnd));
  setOpen(id, true);
  return true;
}

/** `/toggle` and the toolbar: wrap the selected blocks, or make the current line a toggle. */
export function insertToggle(editor: Editor) {
  const { state } = editor;
  const { selection } = state;
  if (!selection.empty && selection.$from.parent !== selection.$to.parent) {
    const before = new Set<string>();
    state.doc.descendants((n) => {
      if (n.type.name === "details") before.add(n.attrs.id);
    });
    if (editor.chain().focus().setDetails().run()) {
      // The id plugin names the new toggle; open it so its content stays visible.
      editor.state.doc.descendants((n) => {
        if (n.type.name === "details" && !before.has(n.attrs.id)) setOpen(n.attrs.id, true);
      });
      return;
    }
  }
  const tr = state.tr;
  if (paragraphToToggle(state, tr, selection.from)) {
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    return;
  }
  const id = uid();
  setOpen(id, true);
  editor
    .chain()
    .focus()
    .insertContent({
      type: "details",
      attrs: { id },
      content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph" }] }],
    })
    .run();
}

/** The editable toggle: an arrow that opens or closes it, then the summary and content. */
export const EditorToggle = Toggle.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ state, range }) => {
          const tr = state.tr.delete(range.from, range.to);
          if (!paragraphToToggle(state, tr, range.from)) return null;
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      // Every toggle needs its own id: new ones, pasted copies and old ones.
      new Plugin({
        key: new PluginKey("toggleIds"),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "details") return;
            const id = String(node.attrs.id || "");
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const next = uid();
            seen.add(next);
            if (isOpen(id)) setOpen(next, true);
            tr = (tr || state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, id: next });
          });
          return tr;
        },
      }),
    ];
  },
  addNodeView() {
    return ({ node }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "toggle-block";
      dom.setAttribute("data-type", "details");
      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.className = "toggle-arrow";
      arrow.contentEditable = "false";
      arrow.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const body = document.createElement("div");
      body.className = "toggle-body";
      dom.append(arrow, body);
      const render = () => {
        const open = isOpen(current.attrs.id);
        dom.classList.toggle("is-open", open);
        arrow.setAttribute("aria-expanded", String(open));
        arrow.setAttribute("aria-label", open ? "Close toggle" : "Open toggle");
      };
      render();
      // Keep the editor's selection where it is when the arrow is pressed.
      arrow.addEventListener("mousedown", (e) => e.preventDefault());
      arrow.addEventListener("click", () => {
        setOpen(current.attrs.id, !isOpen(current.attrs.id));
        render();
      });
      return {
        dom,
        contentDOM: body,
        stopEvent: (event) => arrow.contains(event.target as Node),
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" && (arrow.contains(mutation.target) || mutation.target === dom),
        update: (updated) => {
          if (updated.type !== current.type) return false;
          const wasOpen = isOpen(current.attrs.id);
          if (updated.attrs.id !== current.attrs.id && wasOpen) setOpen(updated.attrs.id, true);
          current = updated;
          render();
          return true;
        },
      };
    };
  },
});

/** Content is shown or hidden by the toggle's open class, so it needs no view of its own. */
export const EditorToggleContent = ToggleContent.extend({
  addNodeView() {
    return null;
  },
});
