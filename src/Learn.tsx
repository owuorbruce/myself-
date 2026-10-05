import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  Flame,
  GraduationCap,
  Heart,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { grade, streak } from "./grading.mjs";
import { buildLesson, lessonStats } from "./lesson";
import type { Page, Workspace } from "./types";
import { studyOf, type Attempt, type Question, type Rating } from "./study";

type Result = "right" | "close" | "wrong";

export function QuestionCard({
  q,
  tag,
  teachHtml,
  onDone,
}: {
  q: Question;
  tag?: string;
  teachHtml?: string;
  onDone: (rating: Rating, correct: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const first = q.answer.split("|")[0];
  const check = () => {
    if (!value.trim() || result) return;
    setResult(grade(value, q.answer));
  };
  const finish = (rating: Rating, correct: boolean) => onDone(rating, correct);
  return (
    <div className={"quiz-card " + (result || "")}>
      {tag && <div className="quiz-tag">{tag}</div>}
      {q.mode === "label" && q.image ? (
        <>
          <h2>{q.prompt}</h2>
          <div className="label-frame quiz-image">
            <img src={q.image.src} alt="Diagram" />
            {q.image.boxes.map((b) => (
              <div
                key={b.id}
                className={
                  "label-box " + (b.id === q.image!.box ? "target" : "dim")
                }
                style={{
                  left: b.x + "%",
                  top: b.y + "%",
                  width: b.w + "%",
                  height: b.h + "%",
                }}
              >
                {b.id === q.image!.box && result && (
                  <span className="label-answer">{first}</span>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <h2 className={q.mode === "typed" ? "cloze" : ""}>
          {q.mode === "typed"
            ? q.prompt.split("_____").map((part, i, all) => (
                <span key={i}>
                  {part}
                  {i < all.length - 1 && <span className="gap">?</span>}
                </span>
              ))
            : q.prompt}
        </h2>
      )}
      {q.mode === "self" ? (
        shown ? (
          <>
            <div className="quiz-answer">
              {q.answerHtml ? (
                <div dangerouslySetInnerHTML={{ __html: q.answerHtml }} />
              ) : (
                <p>{q.answer}</p>
              )}
            </div>
            <div className="quiz-actions">
              <span>Did you know it?</span>
              <button className="bad" onClick={() => finish(0, false)}>
                <X size={16} /> Not yet
              </button>
              <button className="ok" onClick={() => finish(1, true)}>
                Sort of
              </button>
              <button className="good" onClick={() => finish(2, true)}>
                <Check size={16} /> Got it
              </button>
            </div>
          </>
        ) : (
          <div className="quiz-actions">
            <span>Think of the answer, then tap.</span>
            <button
              className="primary"
              autoFocus
              onClick={() => setShown(true)}
            >
              <Eye size={16} /> Show answer
            </button>
          </div>
        )
      ) : (
        <>
          <form
            className="quiz-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (result) {
                finish(
                  result === "right" ? 2 : result === "close" ? 1 : 0,
                  result !== "wrong",
                );
              } else check();
            }}
          >
            <input
              ref={input}
              aria-label="Your answer"
              placeholder="Type your answer"
              value={value}
              readOnly={!!result}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {!result && (
              <button className="primary" type="submit" disabled={!value.trim()}>
                Check
              </button>
            )}
            {!result && (
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  setResult("wrong");
                }}
              >
                I don't know
              </button>
            )}
          </form>
          {result && (
            <div className="quiz-feedback">
              <strong>
                {result === "right"
                  ? "Correct!"
                  : result === "close"
                    ? "Almost. Watch the spelling."
                    : "Not quite."}
              </strong>
              {result !== "right" && (
                <p>
                  Answer: <b>{first}</b>
                </p>
              )}
              {result === "wrong" && teachHtml && (
                <details className="teach-again" open>
                  <summary>Here's the bit you need again</summary>
                  <div dangerouslySetInnerHTML={{ __html: teachHtml }} />
                </details>
              )}
              <div className="quiz-actions">
                {result === "wrong" && value.trim() && (
                  <button onClick={() => finish(1, true)}>
                    I was right
                  </button>
                )}
                <button
                  className="primary"
                  autoFocus
                  onClick={() =>
                    finish(
                      result === "right" ? 2 : result === "close" ? 1 : 0,
                      result !== "wrong",
                    )
                  }
                >
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function attemptOf(q: Question, rating: Rating): Attempt {
  return {
    id: q.key,
    pageId: q.pageId,
    kind: q.kind,
    prompt: q.prompt,
    answer: q.answer,
    ...(q.ref ? { ref: q.ref } : {}),
    rating,
  };
}

type Step =
  | {
      t: "teach";
      title: string;
      html: string;
      section: number;
      part: number;
      of: number;
      quiz: boolean;
    }
  | { t: "pop" }
  | {
      t: "ask";
      q: Question;
      teachHtml: string;
      pop?: boolean;
      retry?: boolean;
      tries?: number;
    };

function pick<T>(list: T[], n: number) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export function LearnView({
  page,
  data,
  onAttempt,
  onReviewCard,
  onExit,
  onEdit,
}: {
  page: Page;
  data: Workspace;
  onAttempt: (a: Attempt) => void;
  onReviewCard: (cardId: string, rating: Rating) => void;
  onExit: () => void;
  onEdit: () => void;
}) {
  const chunks = useMemo(
    () => buildLesson(page, data.cards),
    // Build once per lesson so editing elsewhere doesn't reshuffle it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.id],
  );
  const stats = lessonStats(chunks);
  const initial = useMemo(() => {
    const steps: Step[] = [];
    const pool: { q: Question; teachHtml: string }[] = [];
    chunks.forEach((c, ci) => {
      c.bites.forEach((b, bi) => {
        if (b.html)
          steps.push({
            t: "teach",
            title: c.title,
            html: b.html,
            section: ci + 1,
            part: bi + 1,
            of: c.bites.length,
            quiz: b.questions.length > 0,
          });
        for (const q of b.questions)
          steps.push({ t: "ask", q, teachHtml: b.html });
      });
      pool.push(
        ...c.bites.flatMap((b) =>
          b.questions.map((q) => ({ q, teachHtml: b.html })),
        ),
      );
      if ((ci + 1) % 3 === 0 && ci < chunks.length - 1 && pool.length >= 3) {
        steps.push({ t: "pop" });
        for (const p of pick(pool, 3))
          steps.push({ t: "ask", q: p.q, teachHtml: p.teachHtml, pop: true });
      }
    });
    return steps;
  }, [chunks]);
  const [steps, setSteps] = useState(initial);
  const [pos, setPos] = useState(0);
  const [hearts, setHearts] = useState(3);
  const [xp, setXp] = useState(0);
  const [right, setRight] = useState(0);
  const [asked, setAsked] = useState(0);
  const [missed, setMissed] = useState<Question[]>([]);
  const [out, setOut] = useState(false);
  const [turn, setTurn] = useState(0);
  const step = steps[pos];
  const next = () => {
    setPos((p) => p + 1);
    setTurn((t) => t + 1);
    window.scrollTo({ top: 0 });
  };
  const answered = (s: Extract<Step, { t: "ask" }>, rating: Rating, ok: boolean) => {
    if (s.q.cardId) onReviewCard(s.q.cardId, rating);
    else onAttempt(attemptOf(s.q, rating));
    setAsked((n) => n + 1);
    if (ok) {
      setRight((n) => n + 1);
      setXp((x) => x + (s.retry ? 5 : s.pop ? 15 : 10));
      next();
      return;
    }
    setMissed((m) => (m.some((x) => x.key === s.q.key) ? m : [...m, s.q]));
    // Bring the question back a little later, up to twice.
    if ((s.tries || 0) < 2)
      setSteps((all) => {
        const copy = [...all];
        copy.splice(Math.min(copy.length, pos + 4), 0, {
          ...s,
          retry: true,
          tries: (s.tries || 0) + 1,
        });
        return copy;
      });
    if (hearts <= 1) {
      setHearts(0);
      setOut(true);
    } else {
      setHearts((h) => h - 1);
      next();
    }
  };
  const header = (
    <div className="learn-top">
      <button onClick={onExit} aria-label="Leave lesson">
        <X size={20} />
      </button>
      <div
        className="learn-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={Math.min(pos, steps.length)}
      >
        <span
          style={{
            width:
              (steps.length ? (Math.min(pos, steps.length) / steps.length) * 100 : 0) + "%",
          }}
        />
      </div>
      <span className="learn-hearts" aria-label={hearts + " hearts left"}>
        {[0, 1, 2].map((i) => (
          <Heart
            key={i}
            size={18}
            className={i < hearts ? "full" : "empty"}
            fill={i < hearts ? "currentColor" : "none"}
          />
        ))}
      </span>
      <span className="learn-xp">
        <Sparkles size={15} /> {xp} XP
      </span>
    </div>
  );
  if (!chunks.length)
    return (
      <section className="learn-view">
        {header}
        <div className="learn-card center">
          <GraduationCap size={34} />
          <h2>Nothing to teach yet.</h2>
          <p>
            Write some notes on this page first. Headings split them into
            sections, and <b>bold key terms</b>, blanks and Tap to Learn
            questions become quiz questions.
          </p>
          <button className="primary" onClick={onEdit}>
            Back to the page
          </button>
        </div>
      </section>
    );
  if (out)
    return (
      <section className="learn-view">
        {header}
        <div className="learn-card center">
          <Heart size={40} className="empty" />
          <h2>Out of hearts</h2>
          <p>
            No stress. The ones you missed are coming back so you can get them
            right.
          </p>
          <div className="quiz-actions">
            <button onClick={onExit}>Stop here</button>
            <button
              className="primary"
              onClick={() => {
                setHearts(3);
                setOut(false);
                next();
              }}
            >
              <RotateCcw size={16} /> Refill hearts and keep going
            </button>
          </div>
        </div>
      </section>
    );
  if (!step) {
    const days = streak(studyOf(data).days);
    return (
      <section className="learn-view">
        {header}
        <div className="learn-card center done">
          <Trophy size={40} />
          <h2>Lesson complete!</h2>
          <div className="learn-results">
            <span>
              <strong>{xp}</strong> XP
            </span>
            <span>
              <strong>
                {asked ? Math.round((right / asked) * 100) : 100}%
              </strong>{" "}
              right
            </span>
            <span>
              <Flame size={18} /> <strong>{days}</strong> day streak
            </span>
          </div>
          {missed.length > 0 ? (
            <div className="learn-missed">
              <h3>Your weak spots from this lesson</h3>
              <ul>
                {missed.map((q) => (
                  <li key={q.key}>
                    {q.mode === "label" ? "Label: " : ""}
                    <span>{q.prompt.replace("_____", "___")}</span>{" "}
                    <b>{q.answer.split("|")[0]}</b>
                  </li>
                ))}
              </ul>
              <p>They'll show up in your daily review until they stick.</p>
            </div>
          ) : (
            <p>Clean run. These will come back for a quick review later.</p>
          )}
          <div className="quiz-actions">
            <button onClick={onEdit}>Back to the page</button>
            <button
              className="primary"
              onClick={() => {
                setSteps(initial);
                setPos(0);
                setHearts(3);
                setXp(0);
                setRight(0);
                setAsked(0);
                setMissed([]);
              }}
            >
              <RotateCcw size={16} /> Play again
            </button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="learn-view">
      {header}
      {pos === 0 && (
        <p className="learn-intro">
          <GraduationCap size={16} /> {page.title}: {stats.sections} sections,{" "}
          {stats.questions} questions. Read a little, then answer.
        </p>
      )}
      {step.t === "teach" ? (
        <div className="learn-card teach">
          <div className="quiz-tag">
            Section {step.section} of {chunks.length}
            {step.of > 1 ? ` · part ${step.part} of ${step.of}` : ""}
          </div>
          <h2>{step.title}</h2>
          <div
            className="teach-body note-content"
            dangerouslySetInnerHTML={{ __html: step.html }}
          />
          <div className="quiz-actions">
            <button className="primary" autoFocus onClick={next}>
              {step.quiz ? "Got it, quiz me" : "Next"}{" "}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : step.t === "pop" ? (
        <div className="learn-card center pop">
          <Sparkles size={34} />
          <h2>Pop quiz!</h2>
          <p>Three quick ones from earlier sections. Worth extra XP.</p>
          <button className="primary" autoFocus onClick={next}>
            Bring it on <ChevronRight size={16} />
          </button>
        </div>
      ) : (
        <QuestionCard
          key={turn}
          q={step.q}
          tag={
            step.pop
              ? "Pop quiz"
              : step.retry
                ? "Try this one again"
                : undefined
          }
          teachHtml={step.teachHtml}
          onDone={(rating, ok) => answered(step, rating, ok)}
        />
      )}
    </section>
  );
}

export function ReviewSession({
  title,
  questions,
  data,
  onAttempt,
  onReviewCard,
  onExit,
}: {
  title: string;
  questions: Question[];
  data: Workspace;
  onAttempt: (a: Attempt) => void;
  onReviewCard: (cardId: string, rating: Rating) => void;
  onExit: () => void;
}) {
  const [queue] = useState(questions);
  const [pos, setPos] = useState(0);
  const [right, setRight] = useState(0);
  const q = queue[pos];
  const pageTitle = (id: string | null) =>
    data.pages.find((p) => p.id === id)?.title || "Personal cards";
  if (!q)
    return (
      <div className="learn-card center done">
        <Trophy size={36} />
        <h2>Done for now!</h2>
        <p>
          {right} of {queue.length} right. Streak:{" "}
          <b>
            {streak(studyOf(data).days)} day
            {streak(studyOf(data).days) === 1 ? "" : "s"}
          </b>
          .
        </p>
        <button className="primary" onClick={onExit}>
          Finish
        </button>
      </div>
    );
  return (
    <div className="review-session">
      <div className="learn-top">
        <button onClick={onExit} aria-label="Stop review">
          <ArrowLeft size={18} /> {title}
        </button>
        <div className="learn-progress">
          <span style={{ width: (pos / queue.length) * 100 + "%" }} />
        </div>
        <span className="learn-xp">
          {pos + 1} / {queue.length}
        </span>
      </div>
      <QuestionCard
        key={pos}
        q={q}
        tag={pageTitle(q.pageId)}
        onDone={(rating, ok) => {
          if (q.cardId) onReviewCard(q.cardId, rating);
          else onAttempt(attemptOf(q, rating));
          if (ok) setRight((n) => n + 1);
          setPos((p) => p + 1);
        }}
      />
    </div>
  );
}

