import { randomBytes, timingSafeEqual } from "node:crypto";
import { ChatGPTRuntime, ChatGPTError } from "./chatgpt-auth.mjs";

export function validateInput(body) {
  if (!body || typeof body.model !== "string" || body.model.length > 150 ||
    !Array.isArray(body.input) || !body.input.length || body.input.length > 30)
    throw new ChatGPTError("Choose a model and enter a question.", "invalid_request");
  let length = 0;
  for (const message of body.input) {
    if (!message || !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" || !message.content.trim())
      throw new ChatGPTError("This conversation contains an invalid message.", "invalid_request");
    length += message.content.length;
  }
  if (length > 200000) throw new ChatGPTError("This conversation is too long. Start a new answer with fewer notes.", "context_too_large", 413);
  return { model: body.model, input: body.input.map((m) => ({ role: m.role, content: m.content })) };
}

function equal(a, b) {
  return typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
async function bodyJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new ChatGPTError("JSON is required for this request.", "invalid_request", 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1000000) throw new ChatGPTError("This request is too large.", "request_too_large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChatGPTError("Couldn't read this request.", "invalid_request"); }
}
const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
};
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function callbackPage(res, success, message) {
  res.writeHead(success ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Slate · ChatGPT</title><style>body{font:18px system-ui;max-width:36rem;margin:12vh auto;padding:24px;color:#1f3531;background:#f8fafc}h1{font-size:28px}</style><h1>${success ? "ChatGPT connected" : "ChatGPT sign-in didn't finish"}</h1><p>${escape(message)}</p><p>Return to Slate. You can close this tab.</p></html>`);
}

export function createChatGPTRouter({ runtime = new ChatGPTRuntime() } = {}) {
  const requestToken = randomBytes(32).toString("base64url");
  const running = new Set();
  const abortAll = () => { for (const controller of running) controller.abort(); };
  const route = async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/chatgpt/") && url.pathname !== "/auth/callback") return false;
    // Reject DNS rebinding and cross-origin websites, including other local ports.
    const port = req.socket.localPort;
    const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    const origin = req.headers.origin;
    if (!hosts.has(req.headers.host) ||
      (origin && !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(origin))) {
      json(res, { error: "Open Slate using its local address.", code: "origin_rejected" }, 403); return true;
    }
    if (url.pathname === "/auth/callback") {
      if (req.method !== "GET") { json(res, { error: "Method not allowed." }, 405); return true; }
      try {
        const state = await runtime.finish(new URL(req.url, `http://127.0.0.1:${port}`).href);
        callbackPage(res, true, state.planEnabled ? "Slate can now use eligible usage from your ChatGPT plan." :
          "You're signed in, but permission to use your ChatGPT plan wasn't granted. Return to Slate to enable it.");
      } catch (error) { callbackPage(res, false, error instanceof ChatGPTError ? error.message : "Couldn't complete this connection. Try again in Slate."); }
      return true;
    }
    try {
      if (url.pathname === "/api/chatgpt/session" && req.method === "GET") {
        if (req.headers["sec-fetch-site"] === "cross-site") throw new ChatGPTError("Open Slate locally to connect.", "origin_rejected", 403);
        json(res, { ...(await runtime.status()), requestToken }); return true;
      }
      if (url.pathname === "/api/chatgpt/authorize" && req.method === "GET") {
        const authorizeUrl = runtime.authorize(url.searchParams.get("ticket"));
        res.writeHead(302, { Location: authorizeUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); res.end(); return true;
      }
      if (!equal(req.headers["x-slate-token"], requestToken)) throw new ChatGPTError("Reload Slate before connecting ChatGPT.", "request_rejected", 403);
      if (url.pathname === "/api/chatgpt/models" && req.method === "GET") { json(res, { models: await runtime.models() }); return true; }
      if (req.method !== "POST") { json(res, { error: "Method not allowed." }, 405); return true; }
      const body = await bodyJSON(req);
      if (url.pathname === "/api/chatgpt/sign-in") {
        const ticket = await runtime.begin(`http://127.0.0.1:${port}/auth/callback`, {
          newAccount: body.newAccount === true, enablePlan: body.enablePlan === true,
        });
        json(res, { url: `/api/chatgpt/authorize?ticket=${encodeURIComponent(ticket)}` });
      } else if (url.pathname === "/api/chatgpt/select") {
        abortAll(); json(res, await runtime.select(body.account));
      } else if (url.pathname === "/api/chatgpt/sign-out") {
        abortAll(); json(res, await runtime.signOut());
      } else if (url.pathname === "/api/chatgpt/respond") {
        const input = validateInput(body);
        const controller = new AbortController(); running.add(controller);
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.on("close", cancel);
        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.flushHeaders();
        const send = (item) => { if (!res.destroyed) res.write(JSON.stringify(item) + "\n"); };
        try {
          const answer = await runtime.respond(input, (text) => send({ type: "delta", text }), controller.signal);
          if (!controller.signal.aborted) send({ type: "completed", text: answer });
        } catch (error) {
          send({ type: "error", error: error instanceof ChatGPTError ? error.message : "Couldn't complete the answer. Try again.",
            code: error instanceof ChatGPTError ? error.code : "request_failed" });
        } finally { running.delete(controller); res.off("close", cancel); res.end(); }
      } else json(res, { error: "Not found." }, 404);
    } catch (error) {
      json(res, { error: error instanceof ChatGPTError ? error.message : "Couldn't complete the local ChatGPT request. Check local storage and try again.",
        code: error instanceof ChatGPTError ? error.code : "local_error" }, error instanceof ChatGPTError ? error.status : 500);
    }
    return true;
  };
  route.close = abortAll;
  return route;
}
