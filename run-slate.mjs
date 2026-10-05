import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = path.resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const port = 4173;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".txt": "text/plain",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const target = path.resolve(root, relative);
    if (
      !target.startsWith(root + path.sep) &&
      target !== path.join(root, "index.html")
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!(await stat(target)).isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404);
    res.end("File not found");
  }
});
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? "Port 4173 is already in use. Open http://localhost:4173/ if Slate is already running; otherwise stop the other server."
      : e.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log("Slate is running at http://localhost:4173/");
  console.log(
    "Keep this window open. Press Ctrl+C to stop. Your notes stay saved.",
  );
  if (process.env.SLATE_NO_OPEN === "1") return;
  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", "http://localhost:4173/"]]
      : process.platform === "darwin"
        ? ["open", ["http://localhost:4173/"]]
        : ["xdg-open", ["http://localhost:4173/"]];
  spawn(command[0], command[1], { stdio: "ignore" }).on("error", () => {});
});
