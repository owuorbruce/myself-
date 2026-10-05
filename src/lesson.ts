import type { JSONContent } from "@tiptap/react";
import { generateHTML } from "@tiptap/core";
import { extensions } from "./extensions";
import { plain, type Card, type Page } from "./types";
import { questionsFrom } from "./questions";
import type { Question } from "./study";

export type Bite = { html: string; questions: Question[] };
export type Chunk = { title: string; bites: Bite[] };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function toHTML(nodes: JSONContent[]) {
  try {
    return generateHTML({ type: "doc", content: nodes }, extensions);
  } catch {
    return nodes
      .map((n) => `<p>${escapeHTML(plain(n))}</p>`)
      .join("");
  }
}

export function escapeHTML(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/** Split a page into sections (by heading) and small bites to teach. */
export function buildLesson(page: Page, cards: Card[] = []): Chunk[] {
  const nodes = page.content.content || [];
  const sections: { title: string; nodes: JSONContent[] }[] = [];
  let current = { title: page.title || "Introduction", nodes: [] as JSONContent[] };
  for (const n of nodes) {
    if (n.type === "heading" && (n.attrs?.level || 1) <= 3) {
      if (current.nodes.length) sections.push(current);
      current = { title: plain(n) || "Section", nodes: [] };
      continue;
    }
    if (!plain(n).trim() && n.type !== "labelImage" && n.type !== "image")
      continue;
    current.nodes.push(n);
  }
  if (current.nodes.length) sections.push(current);
  const chunks: Chunk[] = [];
  for (const s of sections) {
    const bites: Bite[] = [];
    let group: JSONContent[] = [];
    let count = 0;
    const flush = () => {
      if (!group.length) return;
      const questions = group.flatMap((n) => questionsFrom(n, page.id, toHTML));
      bites.push({ html: toHTML(group), questions });
      group = [];
      count = 0;
    };
    for (const n of s.nodes) {
      const w =
        n.type === "labelImage" || n.type === "image" ? 60 : words(plain(n));
      if (count && count + w > 90) flush();
      group.push(n);
      count += w;
    }
    flush();
    if (bites.length) chunks.push({ title: s.title, bites });
  }
  // Flashcards made from this page join the last section as a recap.
  const own = cards.filter((c) => c.pageId === page.id);
  if (own.length && chunks.length)
    chunks.push({
      title: "Flashcard recap",
      bites: [
        {
          html: "",
          questions: own.map((c) => ({
            key: "card:" + c.id,
            kind: "card" as const,
            mode: "self" as const,
            pageId: page.id,
            prompt: c.question,
            answer: c.answer,
            cardId: c.id,
          })),
        },
      ],
    });
  return chunks;
}

export function lessonStats(chunks: Chunk[]) {
  return {
    sections: chunks.length,
    questions: chunks.reduce(
      (n, c) => n + c.bites.reduce((m, b) => m + b.questions.length, 0),
      0,
    ),
  };
}

