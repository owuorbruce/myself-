import type { JSONContent } from "@tiptap/react";
import { plain } from "./types";
import { studyToggle } from "./toggle.mjs";
import type { LabelBox, Question } from "./study";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Text of a paragraph-like node, with blanks shown as _____. */
function clozeText(n: JSONContent): string {
  return (n.content || [])
    .map((c) =>
      c.type === "blank"
        ? "_____"
        : c.type === "pageLink"
          ? String(c.attrs?.label || "")
          : c.text || clozeText(c),
    )
    .join("");
}

/** Find a blank even inside a toggle or another nested editor block. */
export function currentBlank(content: JSONContent, pageId: string, key: string): Question | null {
  if (content.type === "paragraph" || content.type === "heading") {
    const question = questionsFrom(content, pageId).find((q) => q.kind === "blank" && q.key === key);
    if (question) return question;
  }
  for (const node of content.content || []) {
    const question = currentBlank(node, pageId, key);
    if (question) return question;
  }
  return null;
}

/** Collect questions from one top-level block. */
export function questionsFrom(node: JSONContent, pageId: string, render?: (nodes: JSONContent[]) => string): Question[] {
  const out: Question[] = [];
  const autos: Question[] = [];
  function walk(n: JSONContent) {
    if (n.type === "details" || n.type === "reveal") {
      // The summary is the prompt and the content is the answer, graded by
      // the learner in Study. The "reveal" key keeps older review history.
      const toggle = studyToggle(n);
      if (!toggle) {
        if (n.type === "details") n.content?.forEach(walk);
        return;
      }
      out.push({
        key: "reveal:" + toggle.id,
        kind: "reveal",
        mode: "self",
        pageId,
        prompt: toggle.summary,
        answer: toggle.answer,
        ...(render ? { answerHtml: render(toggle.blocks) } : {}),
        ref: { node: toggle.id },
      });
      // Toggles nested inside are questions of their own.
      const nested = (b: JSONContent): void => {
        if (b.type === "details") walk(b);
        else b.content?.forEach(nested);
      };
      toggle.blocks.forEach(nested);
      return;
    }
    if (n.type === "labelImage") {
      const boxes = (n.attrs?.boxes || []) as LabelBox[];
      for (const b of boxes)
        out.push({
          key: `label:${n.attrs?.id}:${b.id}`,
          kind: "label",
          mode: "label",
          pageId,
          prompt: "Name the highlighted label",
          answer: b.answer,
          image: { src: n.attrs!.src, boxes, box: b.id },
          ref: { node: String(n.attrs?.id), box: b.id },
        });
      return;
    }
    if (n.type === "paragraph" || n.type === "heading") {
      const blanks = (n.content || []).filter((c) => c.type === "blank");
      if (blanks.length) {
        // One question per blank; the other blanks are shown filled in.
        for (const b of blanks) {
          const text = (n.content || [])
            .map((c) =>
              c === b
                ? "_____"
                : c.type === "blank"
                  ? String(c.attrs?.answer || "").split("|")[0]
                  : c.type === "pageLink"
                    ? String(c.attrs?.label || "")
                    : c.text || "",
            )
            .join("");
          out.push({
            key: "blank:" + b.attrs?.id,
            kind: "blank",
            mode: "typed",
            pageId,
            prompt: text,
            answer: String(b.attrs?.answer || ""),
            ref: { node: String(b.attrs?.id) },
          });
        }
        return;
      }
      // Automatic fill-ins from bold terms.
      const text = clozeText(n);
      for (const c of n.content || []) {
        const term = (c.text || "").trim().replace(/[:.,;]+$/, "");
        if (
          c.marks?.some((m) => m.type === "bold") &&
          term.length >= 2 &&
          term.length <= 60 &&
          words(term) <= 6 &&
          text.length > term.length + 15
        ) {
          const prompt = text.replace(c.text!, "_____");
          if (prompt === text) continue;
          autos.push({
            key: "auto:" + hash(pageId + term + prompt),
            kind: "auto",
            mode: "typed",
            pageId,
            prompt,
            answer: term,
          });
        }
      }
      return;
    }
    n.content?.forEach(walk);
  }
  walk(node);
  // Keep automatic questions to a handful per block so a dense list
  // doesn't turn into a wall of quizzes.
  const room = Math.max(2, Math.round(words(plain(node)) / 35));
  return [...out, ...autos.slice(0, room)];
}
