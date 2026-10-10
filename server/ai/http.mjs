// Shared plumbing for AI providers: errors, requests and streamed replies.

export class AIError extends Error {
  constructor(message, code = "ai_error", status = 400, retryAfter = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/** Seconds to wait, from a Retry-After header (seconds or a date) or a "30s" style delay. */
export function retryAfterSeconds(value, now = Date.now()) {
  if (value === null || value === undefined || value === "") return undefined;
  const text = String(value).trim();
  const seconds = text.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  if (seconds) return Math.max(1, Math.ceil(Number(seconds[1])));
  const date = Date.parse(text);
  if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - now) / 1000));
  return undefined;
}

function retryHint(res, body) {
  const header =
    retryAfterSeconds(res.headers.get("retry-after")) ??
    retryAfterSeconds(res.headers.get("x-ratelimit-reset-requests")) ??
    retryAfterSeconds(res.headers.get("x-ratelimit-reset-tokens"));
  if (header !== undefined) return header;
  // Gemini puts the delay in the error details.
  for (const detail of body?.error?.details || [])
    if (typeof detail?.retryDelay === "string") return retryAfterSeconds(detail.retryDelay);
  return undefined;
}

const upstreamMessage = (body) => {
  const value = body?.error?.message || body?.message || body?.detail || (typeof body?.error === "string" ? body.error : "");
  return typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 300) : "";
};

/**
 * Send a request to a provider. Redirects are refused so an API key can only
 * reach the address it was saved for.
 */
export async function send(label, url, init = {}, { timeout = 30000 } = {}) {
  let res;
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  try {
    res = await fetch(url, { ...init, signal, redirect: "error" });
  } catch (error) {
    if (init.signal?.aborted) throw new AIError("Request stopped.", "cancelled", 499);
    if (signal.aborted) throw new AIError(`${label} took too long to answer. Try again.`, "timeout", 504);
    throw new AIError(`Couldn't reach ${label}. Check your internet connection and the provider's address.`, "network_error", 503);
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status === 429) {
    const wait = retryHint(res, body);
    throw new AIError(
      `${label}'s rate limit was reached.` + (wait ? ` Try again in ${formatWait(wait)}.` : " Try again in a little while."),
      "rate_limited", 429, wait,
    );
  }
  const detail = upstreamMessage(body);
  if (res.status === 401 || res.status === 403) {
    // Keep what the provider said (wrong key, region, unpaid account, model not enabled…),
    // with anything that looks like a key masked.
    const reason = detail.replace(/\b(sk|LTAI)[-_A-Za-z0-9*]{6,}/g, "$1-…");
    throw new AIError(
      `${label} didn't accept the API key.` + (reason ? ` ${label} said: "${reason}".` : "") + " Check it in Settings & backups → AI providers.",
      "unauthorized", res.status,
    );
  }
  throw new AIError(`${label} couldn't complete the request (${res.status})${detail ? ": " + detail : "."}`, "upstream_error", res.status >= 500 ? 502 : 400);
}

export function formatWait(seconds) {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.ceil(minutes / 60)} hours`;
}

async function* lines(response, signal, label) {
  if (!response.body) throw new AIError(`${label} returned no reply.`, "interrupted_response", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new AIError("Request stopped.", "cancelled", 499);
      let chunk;
      try { chunk = await reader.read(); }
      catch {
        if (signal?.aborted) throw new AIError("Request stopped.", "cancelled", 499);
        throw new AIError(`The connection to ${label} ended before the reply finished.`, "interrupted_response", 502);
      }
      if (chunk.done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n?/g, "\n");
      if (buffer.length > 4_000_000) throw new AIError(`${label} sent an oversized reply.`, "invalid_stream", 502);
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        yield buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
      }
    }
    if (buffer) yield buffer;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Server-sent events: yields { event, data } with data parsed as JSON. "[DONE]" ends the stream. */
export async function* sse(response, signal, label) {
  let data = [], event = "";
  const flush = () => {
    const payload = data.join("\n");
    const name = event;
    data = []; event = "";
    if (!payload) return null;
    if (payload === "[DONE]") return { done: true };
    try { return { event: name, data: JSON.parse(payload) }; }
    catch { throw new AIError(`${label} sent a reply Slate couldn't read.`, "invalid_stream", 502); }
  };
  for await (const line of lines(response, signal, label)) {
    if (line === "") {
      const item = flush();
      if (item?.done) return;
      if (item) yield item;
    } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    else if (line.startsWith("event:")) event = line.slice(6).trim();
  }
  const item = flush();
  if (item && !item.done) yield item;
}

/** Newline-delimited JSON (Ollama). */
export async function* ndjson(response, signal, label) {
  for await (const line of lines(response, signal, label)) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); }
    catch { throw new AIError(`${label} sent a reply Slate couldn't read.`, "invalid_stream", 502); }
  }
}

/** Parse tool-call arguments that arrive as a JSON string. */
export function parseArguments(text, label) {
  if (text && typeof text === "object") return text;
  if (!text || !String(text).trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* fall through */ }
  throw new AIError(`${label} sent a tool request Slate couldn't read. Try again.`, "invalid_tool_call", 502);
}

export const MAX_ANSWER = 1_000_000;
export function grow(text, piece, label) {
  const next = text + piece;
  if (next.length > MAX_ANSWER) throw new AIError(`${label}'s answer is too long. Ask for a shorter reply.`, "response_too_large", 413);
  return next;
}
