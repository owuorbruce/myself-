// Slate's MCP server: the same tools for the local endpoint (/mcp in the
// desktop app) and the hosted worker (mcp-remote/). Built on the official
// MCP SDK in stateless Streamable HTTP mode.
import { Server, WebStandardStreamableHTTPServerTransport, ListToolsRequestSchema, CallToolRequestSchema } from "../vendor/mcp-sdk.mjs";
import { NOTE_TOOLS } from "../../src/note-tools.mjs";

export const INSTRUCTIONS = "Tools for the user's Slate notes. Find pages with search_pages or list_pages and read them with get_page before changing them. " +
  "create_page and update_page take Markdown; update_page keeps a snapshot so the user can undo it in Page history. There are no delete tools.";

export function toolList() {
  return NOTE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false },
  }));
}

/**
 * Answer one MCP HTTP request. `call(name, args)` runs a tool and returns a
 * JSON-able result, or throws an Error whose message is shown to the AI app.
 */
export async function handleMcp(request, { call, version = "1.0.0" }) {
  const server = new Server({ name: "slate", title: "Slate", version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await call(req.params.name, req.params.arguments || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "That didn't work." }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => {});
  }
}
