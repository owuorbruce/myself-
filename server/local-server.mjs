import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createChatGPTRouter } from './chatgpt-router.mjs';
import { createAIRouter } from './ai/router.mjs';
import { createMcpRoute } from './mcp/local.mjs';

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.wasm':'application/wasm', '.gz':'application/gzip', '.txt':'text/plain' };
export function createLocalServer({ root, runtime, accounts, mcp, version, contentSecurityPolicy } = {}) {
  root = path.resolve(root);
  const chatgpt = createChatGPTRouter({ runtime });
  const ai = createAIRouter({ runtime, ...(accounts ? { accounts } : {}) });
  const mcpRoute = createMcpRoute({ bridge: mcp, version });
  const server = http.createServer(async (req, res) => {
    try {
      if (await mcpRoute(req, res)) return;
      if (await chatgpt(req, res)) return;
      if (await ai(req, res)) return;
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      if (!(await stat(target)).isFile()) throw Error('not a file');
      res.writeHead(200, {
        'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        ...(contentSecurityPolicy ? { 'Content-Security-Policy': contentSecurityPolicy } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : await readFile(target));
    } catch { if (!res.headersSent) res.writeHead(404); res.end('File not found'); }
  });
  return {
    server,
    async listen(port = 4173) {
      await new Promise((resolve, reject) => {
        const error = (e) => { server.off('listening', ready); reject(e); };
        const ready = () => { server.off('error', error); resolve(); };
        server.once('error', error); server.once('listening', ready);
        server.listen(port, '127.0.0.1');
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      chatgpt.close();
      ai.close();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}
