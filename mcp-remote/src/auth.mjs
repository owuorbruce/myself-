// Sign-in for the hosted Slate MCP server: OAuth 2.1 for AI apps (handled by
// @cloudflare/workers-oauth-provider, with dynamic client registration), and
// GitHub as the identity step. Only the GitHub account in
// ALLOWED_GITHUB_USER can finish signing in.
import { AuthorizationError, CimdFetchError, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import { allowed } from "./allow.mjs";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title, body, status = 200, headers = new Headers()) => {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:10vh auto;padding:0 20px;color:#263631;background:#fbfcfb}h1{font-size:24px}button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #c9d3cd;background:#fff;cursor:pointer}button.primary{background:#234c40;color:#fff;border-color:#234c40}code{background:#f1f4f2;padding:1px 5px;border-radius:4px}li{margin:4px 0}.muted{color:#737e79}</style>
<body>${body}</body></html>`, { status, headers });
};


async function s256(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function githubAuthorizeUrl(env, origin, state, challenge) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: origin + "/callback", state,
    code_challenge: challenge, code_challenge_method: "S256", allow_signup: "false" }).toString();
  return url.href;
}
/** Who signed in at GitHub. The GitHub token is used once here and never kept. */
async function githubLogin(env, origin, code, verifier) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "slate-mcp-remote" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: origin + "/callback", code_verifier: verifier }),
  });
  const token = await res.json().catch(() => ({}));
  if (!token.access_token) throw new Error("GitHub sign-in didn't finish. Try again.");
  const user = await fetch("https://api.github.com/user", {
    headers: { Authorization: "Bearer " + token.access_token, Accept: "application/vnd.github+json", "User-Agent": "slate-mcp-remote" },
  });
  if (!user.ok) throw new Error("Couldn't read your GitHub account. Try again.");
  const { login, id } = await user.json();
  return { login, id };
}

function consentPage(env, details, handle) {
  const local = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>" : "";
  const origin = details.clientDomain ? `Published by <strong>${escape(details.clientDomain)}</strong>.` : "This app registered itself, so its name isn't verified.";
  return `<h1>Connect ${escape(details.clientName)} to Slate?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>${local}
<p>It will be able to search and read your notes in <code>${escape(env.GITHUB_REPO)}</code>, create pages, add to or rewrite pages and add tasks. Every change keeps a snapshot. It can't delete anything.</p>
<p class="muted">Next you'll sign in with GitHub. Only <strong>${escape(env.ALLOWED_GITHUB_USER)}</strong> can sign in.</p>
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<p><button class="primary" name="decision" value="approve">Continue with GitHub</button> <button name="decision" value="deny">Cancel</button></p></form>`;
}

async function readActivity(env) {
  try { return JSON.parse((await env.OAUTH_KV.get("slate:activity")) || "[]"); } catch { return []; }
}
/** Tool name and time only, never content. */
export async function recordActivity(env, tool) {
  const log = await readActivity(env);
  log.push({ tool: String(tool).slice(0, 64), at: Date.now() });
  await env.OAUTH_KV.put("slate:activity", JSON.stringify(log.slice(-50)));
}

const cookie = (headers, name) => (headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);

/** Everything outside /mcp: the consent page, GitHub's callback and the activity page. */
export async function handleWeb(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const oauth = env.OAUTH_PROVIDER;
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.ALLOWED_GITHUB_USER || !env.GITHUB_REPO)
    return page("Slate MCP server", "<h1>Not set up yet</h1><p>Follow <code>mcp-remote/DEPLOY.md</code> to add the GitHub settings.</p>", 503);
  try {
    if (url.pathname === "/" && request.method === "GET")
      return page("Slate MCP server", `<h1>Slate MCP server</h1><p>Add <code>${escape(origin)}/mcp</code> as a connector in claude.ai or ChatGPT developer mode.</p><p><a href="/activity">Recent calls</a></p>`);

    if (url.pathname === "/authorize" && request.method === "GET") {
      const req = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(req);
      const consent = await oauth.beginConsent(req);
      return page("Connect to Slate", consentPage(env, details, consent.handle), 200, consent.headers);
    }
    if (url.pathname === "/authorize" && request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") || "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle);
      const verifier = crypto.randomUUID() + crypto.randomUUID();
      const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
      headers.set("Location", githubAuthorizeUrl(env, origin, state, await s256(verifier)));
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === "/activity" && request.method === "GET") {
      const state = "act." + crypto.randomUUID();
      const verifier = crypto.randomUUID() + crypto.randomUUID();
      await env.OAUTH_KV.put("slate:act:" + state, verifier, { expirationTtl: 600 });
      return new Response(null, { status: 302, headers: {
        Location: githubAuthorizeUrl(env, origin, state, await s256(verifier)),
        "Set-Cookie": `__Host-slate-activity=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
        "Cache-Control": "no-store",
      } });
    }

    if (url.pathname === "/callback" && request.method === "GET") {
      const state = url.searchParams.get("state") || "";
      if (state.startsWith("act.")) {
        const verifier = await env.OAUTH_KV.get("slate:act:" + state);
        await env.OAUTH_KV.delete("slate:act:" + state);
        if (!verifier || cookie(request.headers, "__Host-slate-activity") !== state)
          return page("Sign-in expired", "<h1>That sign-in expired</h1><p><a href=\"/activity\">Try again</a>.</p>", 400);
        const user = await githubLogin(env, origin, url.searchParams.get("code") || "", verifier);
        if (!allowed(env, user.login)) return page("Not allowed", `<h1>Not allowed</h1><p>Only ${escape(env.ALLOWED_GITHUB_USER)} can see this server's activity.</p>`, 403);
        const log = (await readActivity(env)).reverse();
        return page("Recent calls", `<h1>Recent calls</h1><p class="muted">Tool names and times only.</p><ul>${log.map((e) =>
          `<li><code>${escape(e.tool)}</code> <span class="muted">${escape(new Date(e.at).toISOString().replace("T", " ").slice(0, 19))} UTC</span></li>`).join("") || "<li>No calls yet.</li>"}</ul>`);
      }
      const { request: original, data, headers } = await oauth.finishUpstream(request);
      if (url.searchParams.get("error")) {
        headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
        return new Response(null, { status: 302, headers });
      }
      const user = await githubLogin(env, origin, url.searchParams.get("code") || "", data.verifier);
      if (!allowed(env, user.login)) {
        headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
        return page("Not allowed", `<h1>This Slate server is private</h1><p>You signed in to GitHub as ${escape(user.login)}. Only ${escape(env.ALLOWED_GITHUB_USER)} can connect.</p>`, 403);
      }
      const { redirectTo } = await oauth.completeAuthorization({
        request: original, userId: String(user.id), metadata: { login: user.login }, scope: original.scope, props: { login: user.login },
      });
      headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers });
    }
    return page("Not found", "<h1>Not found</h1>", 404);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError)
      return page("Couldn't connect", `<h1>Couldn't connect</h1><p>${escape(error instanceof AuthorizationError ? error.description : "This app couldn't be verified.")}</p><p>Start again from your AI app.</p>`, 400);
    if (error instanceof Error && /GitHub/.test(error.message)) return page("Couldn't sign in", `<h1>Couldn't sign in</h1><p>${escape(error.message)}</p>`, 502);
    throw error;
  }
}
