import { questionsFrom, currentBlank } from "./questions";
import { studyToggle } from "./toggle.mjs";
import type { JSONContent } from "@tiptap/react";
import { schedule, localDay } from "./grading.mjs";
import {
  type Card,
  type Page,
  type StudyItem,
  type StudyKind,
  type Workspace,
} from "./types";

export type Rating = 0 | 1 | 2 | 3;
export type Attempt = {
  id: string;
  pageId: string | null;
  kind: StudyKind;
  prompt: string;
  answer: string;
  ref?: StudyItem["ref"];
  rating: Rating;
};
export type LabelBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  answer: string;
};

/** A question ready to show, whatever it came from. */
export type Question = {
  key: string;
  kind: StudyKind;
  mode: "typed" | "self" | "label";
  pageId: string | null;
  prompt: string;
  answer: string;
  answerHtml?: string;
  image?: { src: string; boxes: LabelBox[]; box: string };
  ref?: StudyItem["ref"];
  cardId?: string;
};

export function studyOf(data: Workspace) {
  return data.study || { items: [], days: [] };
}

export function recordAttempt(data: Workspace, a: Attempt, now = Date.now()) {
  const study = studyOf(data);
  const old = study.items.find((i) => i.id === a.id);
  const next = schedule(old || {}, a.rating, now);
  const item: StudyItem = {
    id: a.id,
    pageId: a.pageId,
    kind: a.kind,
    prompt: a.prompt.slice(0, 2000),
    answer: a.answer.slice(0, 2000),
    ...(a.ref ? { ref: a.ref } : {}),
    right: (old?.right || 0) + (a.rating > 0 ? 1 : 0),
    wrong: (old?.wrong || 0) + (a.rating === 0 ? 1 : 0),
    last: now,
    ...next,
  };
  const today = localDay(now);
  return {
    ...data,
    study: {
      items: old
        ? study.items.map((i) => (i.id === a.id ? item : i))
        : [...study.items, item],
      days: study.days.includes(today)
        ? study.days
        : [...study.days, today].slice(-400),
    },
  };
}

export function reviewCard(data: Workspace, card: Card, rating: Rating) {
  const next = schedule(card, rating);
  const updated = {
    ...data,
    cards: data.cards.map((c) => (c.id === card.id ? { ...c, ...next } : c)),
  };
  return recordAttempt(updated, {
    id: "card:" + card.id,
    pageId: card.pageId,
    kind: "card",
    prompt: card.question,
    answer: card.answer,
    rating,
  });
}

/** Share of attempts that were wrong, weighted toward items missed recently. */
export function weakness(i: StudyItem) {
  const total = i.right + i.wrong;
  if (!i.wrong || !total) return 0;
  return i.wrong / total + (i.interval < 1 ? 0.5 : 0);
}

function findNode(content: JSONContent, id: string): JSONContent | null {
  if (content.attrs?.id === id) return content;
  for (const c of content.content || []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

function cardQuestion(c: Card): Question {
  return {
    key: "card:" + c.id,
    kind: "card",
    mode: "self",
    pageId: c.pageId,
    prompt: c.question,
    answer: c.answer,
    cardId: c.id,
  };
}

/** Turn a stored study item back into a question; null when its source is gone. */
export function itemQuestion(i: StudyItem, pages: Page[]): Question | null {
  const page = i.pageId ? pages.find((p) => p.id === i.pageId) : null;
  if (i.pageId && !page) return null;
  if (i.kind === "label") {
    const node = page && i.ref ? findNode(page.content, i.ref.node) : null;
    const boxes = (node?.attrs?.boxes || []) as LabelBox[];
    const box = boxes.find((b) => b.id === i.ref?.box);
    if (!node || !box) return null;
    return {
      key: i.id,
      kind: "label",
      mode: "label",
      pageId: i.pageId,
      prompt: "Name the highlighted label",
      answer: box.answer,
      image: { src: node.attrs!.src, boxes, box: box.id },
      ref: i.ref,
    };
  }
  if (i.kind === "card") return null;
  if (i.kind === "reveal" && page && i.ref) {
    const toggle = studyToggle(findNode(page.content, i.ref.node) || undefined);
    if (!toggle) return null;
    return {
      key: i.id,
      kind: "reveal",
      mode: "self",
      pageId: i.pageId,
      prompt: toggle.summary,
      answer: toggle.answer,
      ref: i.ref,
    };
  }
  if (i.kind === "blank" || i.kind === "auto") {
    if (!page) return null;
    if (i.kind === "blank") return currentBlank(page.content, page.id, i.id);
    return (page.content.content || [])
      .flatMap((n) => questionsFrom(n, page.id))
      .find((q) => q.key === i.id) || null;
  }
  return {
    key: i.id,
    kind: i.kind,
    mode: i.kind === "reveal" ? "self" : "typed",
    pageId: i.pageId,
    prompt: i.prompt,
    answer: i.answer,
    ref: i.ref,
  };
}

function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Today's short review: weak spots first, then anything due. */
export function dailyQueue(data: Workspace, limit = 15, now = Date.now()) {
  const pages = data.pages.filter((p) => !p.trashed);
  const live = (pageId: string | null) =>
    !pageId || pages.some((p) => p.id === pageId);
  const items = studyOf(data)
    .items.filter((i) => i.kind !== "card" && i.due <= now && live(i.pageId))
    .sort((a, b) => weakness(b) - weakness(a) || a.due - b.due);
  const questions: Question[] = [];
  for (const i of items) {
    const q = itemQuestion(i, pages);
    if (q) questions.push(q);
    if (questions.length >= limit) break;
  }
  const cards = data.cards
    .filter((c) => c.due <= now && live(c.pageId))
    .sort((a, b) => a.due - b.due)
    .slice(0, Math.max(0, limit - questions.length))
    .map(cardQuestion);
  return shuffle([...questions, ...cards]);
}

export function weakQueue(data: Workspace, limit = 15) {
  const pages = data.pages.filter((p) => !p.trashed);
  const out: Question[] = [];
  for (const i of weakSpots(data)) {
    const q =
      i.kind === "card"
        ? (() => {
            const c = data.cards.find((c) => "card:" + c.id === i.id);
            return c ? cardQuestion(c) : null;
          })()
        : itemQuestion(i, pages);
    if (q) out.push(q);
    if (out.length >= limit) break;
  }
  return shuffle(out);
}

export function weakSpots(data: Workspace) {
  const active = data.pages.filter((p) => !p.trashed);
  const pages = new Set(active.map((p) => p.id));
  return studyOf(data)
    .items.filter(
      (i) => weakness(i) > 0 && (!i.pageId || pages.has(i.pageId)) &&
        (i.kind === "card" ? data.cards.some((c) => "card:" + c.id === i.id) : !!itemQuestion(i, active)),
    )
    .sort((a, b) => weakness(b) - weakness(a) || b.last - a.last);
}

export function dueCount(data: Workspace, now = Date.now()) {
  const active = data.pages.filter((p) => !p.trashed);
  const pages = new Set(data.pages.filter((p) => !p.trashed).map((p) => p.id));
  const live = (id: string | null) => !id || pages.has(id);
  return (
    studyOf(data).items.filter(
      (i) => i.kind !== "card" && i.due <= now && live(i.pageId) && !!itemQuestion(i, active),
    ).length +
    data.cards.filter((c) => c.due <= now && live(c.pageId)).length
  );
}
