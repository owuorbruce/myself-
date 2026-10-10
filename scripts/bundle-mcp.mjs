// Bundles the parts of the official MCP SDK that Slate uses into one file,
// so the local launcher and the packaged desktop app need no node_modules.
// Run with `npm run bundle:mcp` after updating @modelcontextprotocol/sdk.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const sdk = JSON.parse(await readFile(new URL("../node_modules/@modelcontextprotocol/sdk/package.json", import.meta.url), "utf8"));
await build({
  stdin: {
    contents: [
      'export { Server } from "@modelcontextprotocol/sdk/server/index.js";',
      'export { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";',
      'export { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";',
    ].join("\n"),
    resolveDir: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    sourcefile: "mcp-sdk-entry.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  target: "es2022",
  minify: true,
  legalComments: "eof",
  outfile: "server/vendor/mcp-sdk.mjs",
  banner: { js: `// @modelcontextprotocol/sdk ${sdk.version} (MIT), bundled by scripts/bundle-mcp.mjs. Do not edit.` },
  logLevel: "warning",
});
console.log("Bundled @modelcontextprotocol/sdk " + sdk.version);
