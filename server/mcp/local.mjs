// /mcp on the local server, for Claude Desktop, Claude Code and other AI
// apps on this computer. The notes live in the Slate window, so each tool
// call is handed to it (through the desktop app) and runs through the same
// save queue, snapshots and sync bookkeeping as the editor.
import { timingSafeEqual } from "node:crypto";
import { handleMcp } from "./core.mjs";

const MAX_BODY = 4_000_000;

function same(a, b) {
  return typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function reply(res, status, error, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: error } }));
}

/**
 * bridge (desktop app only): {
 *   config(): { enabled, token }
 *   call(name, args): Promise<result>   // throws "Open Slate first…" when the window isn't ready
 *   record(name): void                  // the call log: tool name and time only
 * }
 */
export function createMcpRoute({ bridge, version } = {}) {
  return async function mcp(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/mcp") return false;
    const port = req.socket.localPort;
    // Block web pages, including DNS rebinding: only this computer's own
    // address, and no browser Origin at all.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host) || req.headers.origin !== undefined) {
      reply(res, 403, "Slate's MCP server only accepts AI apps on this computer.");
      return true;
    }
    if (!bridge) {
      reply(res, 503, "Slate's MCP server runs in the Slate desktop app. Open Slate first.");
      return true;
    }
    const config = await bridge.config();
    if (!config.enabled) {
      reply(res, 403, "Turn on Settings & backups → Connect an AI app in Slate first.");
      return true;
    }
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ") || !same(auth.slice(7).trim(), config.token)) {
      reply(res, 401, "Slate needs the access token shown in Settings & backups → Connect an AI app.", { "WWW-Authenticate": 'Bearer realm="slate"' });
      return true;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) { reply(res, 413, "This request is too large."); return true; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method, headers, ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
    });
    const response = await handleMcp(request, {
      version,
      call: async (name, args) => {
        bridge.record(name);
        return bridge.call(name, args);
      },
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return true;
  };
}
