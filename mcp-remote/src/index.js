// Slate's hosted MCP server (Cloudflare Worker): the same tools as the local
// server, reading and writing the private Slate sync repository on GitHub.
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { handleMcp } from "../../server/mcp/core.mjs";
import { parseRich } from "../../src/markdown.ts";
import { plain } from "../../src/types.ts";
import { ToolError } from "../../src/note-tools.mjs";
import { SlateRepo, RepoError, runRepoTool } from "./repo.mjs";
import { handleWeb, recordActivity } from "./auth.mjs";
import { allowed } from "./allow.mjs";

const deps = { parse: parseRich, plain, newId: () => crypto.randomUUID() };
let repo;

const mcpApi = {
  async fetch(request, env, ctx) {
    // Signed in, but double-check it's still the one allowed account.
    if (!allowed(env, ctx.props?.login)) return new Response("Forbidden", { status: 403 });
    repo ||= new SlateRepo({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO });
    return handleMcp(request, {
      call: async (name, args) => {
        ctx.waitUntil(recordActivity(env, name).catch(() => {}));
        try {
          return await runRepoTool(repo, name, args, deps);
        } catch (error) {
          // Only Slate's own messages go back; never the token or GitHub's raw replies.
          if (error instanceof RepoError || error instanceof ToolError) throw error;
          console.error("Slate MCP tool failed", name, error instanceof Error ? error.name : "unknown");
          throw new Error("Something went wrong on the Slate server. Try again.");
        }
      },
    });
  },
};

const webApi = { fetch: (request, env) => handleWeb(request, env) };

let provider;
export default {
  fetch(request, env, ctx) {
    const origin = (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
    provider ||= new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: mcpApi,
      defaultHandler: webApi,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: ["notes"],
      resourceMetadata: { resource: origin + "/mcp" },
      accessTokenTTL: 3600,
    });
    return provider.fetch(request, env, ctx);
  },
};
