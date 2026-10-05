import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLocalServer } from './server/local-server.mjs';
const local = createLocalServer({ root: fileURLToPath(new URL('./dist/', import.meta.url)) });
try {
  await local.listen(4173);
  console.log('Slate is running at http://localhost:4173/');
  console.log('ChatGPT sign-in is available in Settings and Ask ChatGPT. No API key is required.');
  console.log('Keep this window open. Press Ctrl+C to stop. Your notes stay saved.');
  if (process.env.SLATE_NO_OPEN !== '1') {
    const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', 'http://localhost:4173/']]
      : process.platform === 'darwin' ? ['open', ['http://localhost:4173/']] : ['xdg-open', ['http://localhost:4173/']];
    spawn(command[0], command[1], { stdio: 'ignore' }).on('error', () => {});
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void local.close().finally(() => process.exit()); });
} catch (e) {
  console.error(e.code === 'EADDRINUSE' ? 'Port 4173 is already in use. Open http://localhost:4173/ if Slate is already running; otherwise stop the other server.' : e.message);
  process.exitCode = 1;
}
