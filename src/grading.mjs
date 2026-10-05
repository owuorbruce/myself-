// Pure helpers shared by the app and the Node tests.

const ARTICLES = new Set(["the", "a", "an"]);

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[−–]/g, "-")
    .replace(/[^a-z0-9\s+\-./%°=<>]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w))
    .join(" ");
}

function distance(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return row[b.length];
}

/**
 * Compare a typed answer with the accepted answers ("a|b|c").
 * Returns "right", "close" (a spelling slip or partly right) or "wrong".
 */
export function grade(input, answers) {
  const given = normalize(input);
  if (!given) return "wrong";
  const accepted = String(answers || "")
    .split("|")
    .map(normalize)
    .filter(Boolean);
  if (!accepted.length) return "wrong";
  if (accepted.includes(given)) return "right";
  for (const answer of accepted) {
    const allowed = Math.max(1, Math.floor(answer.length * 0.2));
    if (distance(given, answer) <= allowed) return "close";
    const words = answer.split(" ");
    if (
      words.length > 1 &&
      given.length >= 4 &&
      words.some((w) => w.length > 3 && given.split(" ").includes(w))
    )
      return "close";
  }
  return "wrong";
}

const DAY = 86400000;

/**
 * Spaced repetition step. rating: 0 again, 1 hard, 2 good, 3 easy.
 * interval is in days. Returns the new { interval, ease, due }.
 */
export const gradeRating = (result) => result === "right" ? 2 : 0;
export const gradeCorrect = (result) => result === "right";

export function schedule(previous, rating, now = Date.now()) {
  let interval = previous.interval || 0;
  let ease = previous.ease || 2.5;
  if (rating === 0) {
    ease = Math.max(1.3, ease - 0.2);
    return { interval: 0, ease, due: now + 10 * 60000 };
  }
  if (rating === 1) {
    ease = Math.max(1.3, ease - 0.15);
    interval = interval ? Math.max(1, interval * 1.2) : 1;
  } else if (rating === 2) {
    interval = interval ? interval * ease : 1;
  } else {
    ease = ease + 0.15;
    interval = interval ? interval * ease * 1.3 : 4;
  }
  interval = Math.min(365, Math.round(interval * 10) / 10);
  return { interval, ease, due: now + interval * DAY };
}

export function label(interval) {
  if (!interval) return "10 min";
  if (interval < 1.5) return "1 day";
  if (interval < 30) return Math.round(interval) + " days";
  return Math.round(interval / 30) + " mo";
}

export function localDay(time = Date.now()) {
  const d = new Date(time);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Consecutive study days ending today (or yesterday, if today isn't done yet). */
export function streak(days, now = Date.now()) {
  const set = new Set(days);
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  let cursor = noon.getTime();
  if (!set.has(localDay(cursor))) cursor -= DAY;
  let count = 0;
  while (set.has(localDay(cursor))) {
    count++;
    cursor -= DAY;
  }
  return count;
}

