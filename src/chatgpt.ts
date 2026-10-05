export type ChatGPTSession = {
  available: boolean; connected: boolean; planEnabled: boolean;
  account: string; active: string; pending: boolean; error: string;
  accounts: { id: string; label: string }[];
};
export type ChatGPTModel = { id: string; name: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
let requestToken = "";
export const localChatGPT = () => ["localhost", "127.0.0.1"].includes(location.hostname);

async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const res = await fetch(new URL("api/chatgpt/" + path, location.href), {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    headers: { ...(requestToken ? { "X-Slate-Token": requestToken } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "The ChatGPT helper isn't running. Start Slate with start-slate or node run-slate.mjs.");
  }
  return res;
}
export async function chatGPTSession(): Promise<ChatGPTSession> {
  const res = await request("session"); const data = await res.json();
  if (data.available !== true || typeof data.requestToken !== "string") throw new Error("Start Slate with its local launcher to connect ChatGPT.");
  requestToken = data.requestToken; const { requestToken: _token, ...session } = data;
  return session;
}
export async function signInChatGPT(options: { newAccount?: boolean; enablePlan?: boolean } = {}) {
  // Open a window during the click, before awaiting, to avoid popup blocking.
  const desktop = window.slateDesktop;
  const popup = desktop ? null : window.open("about:blank", "_blank");
  if (!desktop && !popup) throw new Error("Your browser blocked the sign-in tab. Allow popups for local Slate and try again.");
  if (popup) popup.opener = null;
  try {
    await chatGPTSession();
    const res = await request("sign-in", options); const data = await res.json();
    const url = new URL(data.url, location.origin);
    if (url.origin !== location.origin || url.pathname !== "/api/chatgpt/authorize") throw new Error("Invalid sign-in link.");
    if (desktop) await desktop.openSignIn(url.href);
    else if (popup) popup.location.href = url.href;
  } catch (error) { popup?.close(); throw error; }
}
export async function signOutChatGPT(): Promise<ChatGPTSession> {
  await chatGPTSession(); return (await request("sign-out", {})).json();
}
export async function selectChatGPTAccount(account: string): Promise<ChatGPTSession> {
  await chatGPTSession(); return (await request("select", { account })).json();
}
export async function chatGPTModels(): Promise<ChatGPTModel[]> {
  await chatGPTSession(); return (await (await request("models")).json()).models;
}
export async function askChatGPT(model: string, input: ChatMessage[], onText: (text: string) => void, signal: AbortSignal) {
  const session = await chatGPTSession();
  if (!session.planEnabled) throw new Error("Connect ChatGPT and allow plan usage first.");
  const res = await request("respond", { model, input }, signal);
  if (!res.body) throw new Error("No answer stream was returned.");
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "", answer = "", complete = false;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "ChatGPT couldn't finish the answer.");
    if (event.type === "delta") { answer += event.text; onText(answer); }
    if (event.type === "completed") { answer = event.text; complete = true; onText(answer); }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) handle(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) { handle(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    if (!complete || !answer.trim()) throw new Error("ChatGPT didn't finish this answer. Try again.");
    return answer;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
