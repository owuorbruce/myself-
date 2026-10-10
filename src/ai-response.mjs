export function flashcardsFromAnswer(text) {
  const source = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let cards;
  try { cards = JSON.parse(source); } catch { throw new Error("The answer isn't a valid flashcard list. Ask for a JSON array with question and answer fields."); }
  if (!Array.isArray(cards) || !cards.length || cards.length > 200 || !cards.every((c) =>
    c && typeof c.question === "string" && typeof c.answer === "string" &&
    c.question.trim() && c.answer.trim() && c.question.length <= 2000 && c.answer.length <= 2000))
    throw new Error("The flashcard list must contain 1–200 cards with question and answer text under 2,000 characters each.");
  return cards.map((c) => ({ question: c.question.trim(), answer: c.answer.trim() }));
}
