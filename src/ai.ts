// Client for the local AI helper (server/ai). Keys never reach the page.
export type AIProvider = {
  type: string; label: string; needsKey: boolean; local: boolean; custom: boolean; signIn: boolean;
  keyUrl: string; defaultBaseUrl: string; editableBaseUrl: boolean; preferredModel: string;
  presets: { id: string; name: string; baseUrl: string; keyUrl?: string }[];
  regions: { id: string; name: string; baseUrl: string }[];
};
export type AIAccount = { id: string; type: string; name: string; baseUrl: string; hasKey: boolean; keyHint: string };
export type AIModel = { id: string; name: string; tools: boolean | null };
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type AIMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; native?: unknown; provider?: string }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ChatResult = { text: string; toolCalls: ToolCall[]; native?: unknown };

export class AIRequestError extends Error {
  constructor(message: string, public code = "ai_error", public retryAfter?: number) {
    super(message);
  }
}

export const localAI = () => ["localhost", "127.0.0.1"].includes(location.hostname);

let token = "";
async function session() {
  if (token) return token;
  let res: Response;
  try {
    res = await fetch(new URL("api/ai/session", location.href), { cache: "no-store" });
  } catch {
    throw new AIRequestError("The Slate helper isn't running. Open the Slate app, or start it with start-slate.", "helper_unavailable");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.requestToken !== "string") throw new AIRequestError(data.error || "Open Slate from its desktop app or launcher to use AI.", "helper_unavailable");
  return (token = data.requestToken);
}
async function request(path: string, body?: unknown, signal?: AbortSignal, retry = true): Promise<Response> {
  const res = await fetch(new URL("api/ai/" + path, location.href), {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    headers: { "X-Slate-Token": await session(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    if (signal?.aborted) throw new AIRequestError("Stopped.", "cancelled");
    throw new AIRequestError("The Slate helper isn't running. Open the Slate app, or start it with start-slate.", "helper_unavailable");
  });
  if (res.status === 403 && retry) {
    // The helper restarted: get a new page token once.
    token = "";
    return request(path, body, signal, false);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new AIRequestError(data.error || "The AI request didn't work. Try again.", data.code, data.retryAfter);
  }
  return res;
}

export async function aiProviders(): Promise<{ providers: AIProvider[]; accounts: AIAccount[]; chatgpt: { connected: boolean; account: string } }> {
  return (await request("providers")).json();
}
export async function saveProvider(input: { id?: string; type: string; name?: string; baseUrl?: string; apiKey?: string }): Promise<AIAccount> {
  return (await (await request("providers/save", input)).json()).account;
}
export async function removeProvider(id: string) {
  await request("providers/remove", { id });
}
export async function aiModels(account: string, signal?: AbortSignal): Promise<AIModel[]> {
  return (await (await request("models?account=" + encodeURIComponent(account), undefined, signal)).json()).models;
}
export async function checkTools(account: string, model: string): Promise<{ tools: boolean; detail?: string }> {
  return (await request("check-tools", { account, model })).json();
}

/** One model turn, streamed. Throws AIRequestError (with retryAfter on rate limits). */
export async function aiChat(
  input: { account: string; model: string; system: string; messages: AIMessage[]; tools: ToolSpec[] },
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<ChatResult> {
  const messages = input.messages.map((m) => {
    if (m.role !== "assistant") return m;
    // A provider's private turn data only goes back to that provider.
    const { provider, native, ...rest } = m;
    return native && provider === input.account ? { ...rest, native } : rest;
  });
  const res = await request("chat", { ...input, messages }, signal);
  if (!res.body) throw new AIRequestError("No answer came back. Try again.", "interrupted_response");
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "", text = "", result: ChatResult | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new AIRequestError(event.error || "The AI couldn't finish.", event.code, event.retryAfter);
    if (event.type === "delta") { text += event.text; onText(text); }
    if (event.type === "done") result = { text: event.text, toolCalls: event.toolCalls || [], native: event.native };
  };
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch {
        if (signal.aborted) throw new AIRequestError("Stopped.", "cancelled");
        throw new AIRequestError("The connection ended before the answer finished. Try again.", "interrupted_response");
      }
      if (chunk.done) { buffer += decoder.decode(); if (buffer.trim()) handle(buffer); break; }
      buffer += decoder.decode(chunk.value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) { handle(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    if (signal.aborted) throw new AIRequestError("Stopped.", "cancelled");
    if (!result) throw new AIRequestError("The answer didn't finish. Try again.", "interrupted_response");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The last model picked, remembered on this device. */
const CHOICE_KEY = "slate-ai-model";
export type Choice = { account: string; model: string };
export function savedChoice(): Choice | null {
  try {
    const value = JSON.parse(localStorage.getItem(CHOICE_KEY) || "null");
    return value && typeof value.account === "string" && typeof value.model === "string" ? value : null;
  } catch { return null; }
}
export function rememberChoice(choice: Choice) {
  try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* storage unavailable */ }
}

/** Models that refused tools are answers-only from then on, on this device. */
const NO_TOOLS_KEY = "slate-ai-no-tools";
export function learnedNoTools(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(NO_TOOLS_KEY) || "[]")); } catch { return new Set(); }
}
export function rememberNoTools(account: string, model: string, noTools: boolean) {
  const set = learnedNoTools();
  const key = account + "::" + model;
  if (noTools) set.add(key); else set.delete(key);
  try { localStorage.setItem(NO_TOOLS_KEY, JSON.stringify([...set].slice(-500))); } catch { /* storage unavailable */ }
}
