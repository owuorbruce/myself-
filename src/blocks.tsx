import { useEffect, useRef, useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, Eye, EyeOff, Pencil, RotateCcw, Tag, X } from "lucide-react";
import { Reveal, Blank, LabelImage } from "./extensions";
import { gradeRating, grade } from "./grading.mjs";
import { uid } from "./types";
import type { Attempt, LabelBox } from "./study";

type Result = "right" | "close" | "wrong";
const rating = gradeRating;

/** Interactive blocks report attempts by bubbling an event to the editor. */
function report(from: Element | null, attempt: Omit<Attempt, "pageId">) {
  from?.dispatchEvent(
    new CustomEvent("slate-attempt", { bubbles: true, detail: attempt }),
  );
}

const fromControl = ({ event }: { event: Event }) =>
  !!(event.target as HTMLElement | null)?.closest?.(
    "input, textarea, button, select, .label-frame",
  );

function useStableId(props: NodeViewProps) {
  useEffect(() => {
    if (!props.node.attrs.id) props.updateAttributes({ id: uid() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function RevealView(props: NodeViewProps) {
  const { node, updateAttributes } = props;
  useStableId(props);
  const [open, setOpen] = useState(!node.attrs.question);
  const [marked, setMarked] = useState<"" | "got" | "missed">("");
  const mark = (got: boolean, el: Element) => {
    setMarked(got ? "got" : "missed");
    report(el, {
      id: "reveal:" + node.attrs.id,
      kind: "reveal",
      prompt: node.attrs.question,
      answer: node.textContent,
      ref: { node: node.attrs.id },
      rating: got ? 2 : 0,
    });
  };
  return (
    <NodeViewWrapper
      className={"reveal-block " + (open ? "open " : "") + marked}
    >
      <div className="reveal-head" contentEditable={false}>
        <span className="reveal-badge">
          <Eye size={14} /> Tap to learn
        </span>
        <input
          className="reveal-question"
          aria-label="Question"
          value={node.attrs.question}
          placeholder="Type a question, then write the answer below…"
          onChange={(e) => updateAttributes({ question: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />
        <button
          className="reveal-toggle"
          onClick={() => {
            setOpen((o) => !o);
            setMarked("");
          }}
        >
          {open ? <EyeOff size={15} /> : <Eye size={15} />}
          {open ? "Hide" : "Tap to reveal"}
        </button>
      </div>
      <NodeViewContent
        className="reveal-answer"
        style={open ? undefined : { display: "none" }}
      />
      {open && node.attrs.question && (
        <div className="reveal-grade" contentEditable={false}>
          {marked ? (
            <span>
              {marked === "got"
                ? "Nice. It will come back later to keep it fresh."
                : "Saved to your weak spots. It'll come back soon."}
            </span>
          ) : (
            <>
              <span>Did you know it?</span>
              <button onClick={(e) => mark(true, e.currentTarget)}>
                <Check size={14} /> Got it
              </button>
              <button onClick={(e) => mark(false, e.currentTarget)}>
                <X size={14} /> Not yet
              </button>
            </>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function BlankView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;
  useStableId(props);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"" | Result | "shown">("");
  const answer = String(node.attrs.answer || "");
  const sentence = () => {
    try {
      const pos = getPos();
      if (typeof pos !== "number") return "";
      const parent = editor.state.doc.resolve(pos).parent;
      let text = "";
      parent.forEach((child) => {
        text +=
          child === node
            ? "_____"
            : child.type.name === "blank"
              ? String(child.attrs.answer).split("|")[0]
              : child.textContent;
      });
      return text;
    } catch {
      return "_____";
    }
  };
  const check = (el: Element) => {
    if (!value.trim() || state === "shown") return;
    const r = grade(value, answer);
    setState(r);
    report(el, {
      id: "blank:" + node.attrs.id,
      kind: "blank",
      ref: { node: String(node.attrs.id) },
      prompt: sentence(),
      answer,
      rating: rating(r),
    });
  };
  const width = Math.min(
    24,
    Math.max(5, answer.split("|")[0].length + 2, value.length + 2),
  );
  return (
    <NodeViewWrapper
      as="span"
      className={"blank-inline " + state}
      data-blank=""
    >
      <input
        aria-label="Fill in the blank"
        style={{ width: width + "ch" }}
        value={value}
        placeholder="?"
        readOnly={state === "shown"}
        onChange={(e) => {
          setValue(e.target.value);
          if (state && state !== "shown") setState("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            check(e.currentTarget);
          }
        }}
        onBlur={(e) => check(e.currentTarget)}
      />
      {state === "close" && (
        <span className="blank-hint">almost: {answer.split("|")[0]}</span>
      )}
      <span className="blank-tools">
        <button
          title="Show the answer"
          aria-label="Show the answer"
          onClick={(e) => {
            if (state !== "right" && state !== "shown")
              report(e.currentTarget, {
                id: "blank:" + node.attrs.id,
                kind: "blank",
      ref: { node: String(node.attrs.id) },
                prompt: sentence(),
                answer,
                rating: 0,
              });
            setValue(answer.split("|")[0]);
            setState("shown");
          }}
        >
          ?
        </button>
        {state && (
          <button
            title="Try again"
            aria-label="Try again"
            onClick={() => {
              setValue("");
              setState("");
            }}
          >
            <RotateCcw size={11} />
          </button>
        )}
        {editor.isEditable && (
          <button
            title="Edit the answer"
            aria-label="Edit the answer"
            onClick={() => {
              const next = prompt(
                "Answer for this blank (separate alternatives with |)",
                answer,
              );
              if (next?.trim()) updateAttributes({ answer: next.trim() });
            }}
          >
            <Pencil size={11} />
          </button>
        )}
      </span>
    </NodeViewWrapper>
  );
}

function LabelImageView(props: NodeViewProps) {
  const { node, updateAttributes, editor } = props;
  useStableId(props);
  const boxes = (node.attrs.boxes || []) as LabelBox[];
  const [editing, setEditing] = useState(!boxes.length);
  const [values, setValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<LabelBox | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const point = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
    };
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  const setBoxes = (next: LabelBox[]) => updateAttributes({ boxes: next });
  const checkAll = (el: Element) => {
    const out: Record<string, Result> = {};
    for (const b of boxes) {
      const v = values[b.id] || "";
      if (!v.trim()) continue;
      out[b.id] = grade(v, b.answer);
      report(el, {
        id: `label:${node.attrs.id}:${b.id}`,
        kind: "label",
        prompt: "Name the highlighted label",
        answer: b.answer,
        ref: { node: node.attrs.id, box: b.id },
        rating: rating(out[b.id]),
      });
    }
    setResults(out);
  };
  const right = Object.values(results).filter((r) => r === "right").length;
  return (
    <NodeViewWrapper
      className={"label-block " + (editing ? "editing" : "")}
      contentEditable={false}
    >
      <div className="label-toolbar">
        <span className="reveal-badge">
          <Tag size={14} /> Label the image
        </span>
        {editing ? (
          <>
            <span className="label-help">
              Drag across the picture to cover a label, then type its answer.
              Click a box to change or remove it.
            </span>
            <button
              className="primary"
              disabled={!boxes.length}
              onClick={() => setEditing(false)}
            >
              <Check size={15} /> Done
            </button>
          </>
        ) : (
          <>
            {Object.keys(results).length > 0 && (
              <span className="label-score">
                {right} / {boxes.length} right
              </span>
            )}
            <button onClick={(e) => checkAll(e.currentTarget)}>
              <Check size={15} /> Check
            </button>
            <button onClick={() => setShowAll((s) => !s)}>
              {showAll ? <EyeOff size={15} /> : <Eye size={15} />}
              {showAll ? "Hide answers" : "Show answers"}
            </button>
            <button
              onClick={() => {
                const keep = { ...values };
                for (const [id, r] of Object.entries(results))
                  if (r !== "right") delete keep[id];
                setValues(keep);
                setResults((old) =>
                  Object.fromEntries(
                    Object.entries(old).filter(([, r]) => r === "right"),
                  ),
                );
              }}
            >
              <RotateCcw size={15} /> Retry mistakes
            </button>
            {editor.isEditable && (
              <button onClick={() => setEditing(true)}>
                <Pencil size={15} /> Edit boxes
              </button>
            )}
          </>
        )}
      </div>
      <div
        className="label-frame"
        ref={frame}
        onPointerDown={(e) => {
          if (!editing || (e.target as HTMLElement).closest(".label-box"))
            return;
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          start.current = point(e);
          setDraft({ id: "", ...start.current, w: 0, h: 0, answer: "" });
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = point(e);
          setDraft({
            id: "",
            x: Math.min(p.x, start.current.x),
            y: Math.min(p.y, start.current.y),
            w: Math.abs(p.x - start.current.x),
            h: Math.abs(p.y - start.current.y),
            answer: "",
          });
        }}
        onPointerUp={() => {
          const d = draft;
          start.current = null;
          setDraft(null);
          if (!d || d.w < 1.5 || d.h < 1.5) return;
          const answer = prompt(
            "What's the label in this box? (separate alternatives with |)",
          );
          if (!answer?.trim()) return;
          setBoxes([
            ...boxes,
            {
              id: uid().slice(0, 8),
              x: round(d.x),
              y: round(d.y),
              w: round(d.w),
              h: round(d.h),
              answer: answer.trim(),
            },
          ]);
        }}
      >
        <img src={node.attrs.src} alt="Diagram to label" draggable={false} />
        {boxes.map((b) => {
          const r = results[b.id];
          return (
            <div
              key={b.id}
              className={"label-box " + (r || "")}
              style={{
                left: b.x + "%",
                top: b.y + "%",
                width: b.w + "%",
                height: b.h + "%",
              }}
              onClick={() => {
                if (!editing) return;
                const next = prompt(
                  "Change this label, or clear it to remove the box",
                  b.answer,
                );
                if (next === null) return;
                setBoxes(
                  next.trim()
                    ? boxes.map((x) =>
                        x.id === b.id ? { ...x, answer: next.trim() } : x,
                      )
                    : boxes.filter((x) => x.id !== b.id),
                );
              }}
            >
              {editing || showAll ? (
                <span className="label-answer">{b.answer.split("|")[0]}</span>
              ) : (
                <input
                  aria-label="Label"
                  value={values[b.id] || ""}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [b.id]: e.target.value }));
                    setResults((old) => {
                      const n = { ...old };
                      delete n[b.id];
                      return n;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      checkAll(e.currentTarget);
                    }
                  }}
                />
              )}
              {r === "close" && !showAll && (
                <span className="label-near">{b.answer.split("|")[0]}</span>
              )}
            </div>
          );
        })}
        {draft && (
          <div
            className="label-box draft"
            style={{
              left: draft.x + "%",
              top: draft.y + "%",
              width: draft.w + "%",
              height: draft.h + "%",
            }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const interactiveExtensions = [
  Reveal.extend({
    addNodeView() {
      return ReactNodeViewRenderer(RevealView, { stopEvent: fromControl });
    },
  }),
  Blank.extend({
    addNodeView() {
      return ReactNodeViewRenderer(BlankView, {
        as: "span",
        stopEvent: fromControl,
      });
    },
  }),
  LabelImage.extend({
    addNodeView() {
      return ReactNodeViewRenderer(LabelImageView, {
        stopEvent: fromControl,
        ignoreMutation: () => true,
      });
    },
  }),
];

