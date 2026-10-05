import { app, BrowserWindow, ipcMain, Menu, shell, dialog, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { DESKTOP_ORIGIN, DESKTOP_CSP, isAppPage, externalLink, signInTicket, providerLink } from './security.mjs';

const smokeMode = process.argv.find(v => v.startsWith('--slate-smoke='))?.split('=')[1];
const smokeDir = process.env.SLATE_SMOKE_DIR;
app.setName('Slate');
if (smokeMode) {
  if (!smokeDir || !['write', 'read'].includes(smokeMode)) throw Error('Smoke checks require an isolated profile.');
  app.setPath('userData', path.join(smokeDir, 'profile'));
  process.env.SLATE_CHATGPT_DIR = path.join(smokeDir, 'auth');
}
const firstInstance = app.requestSingleInstanceLock();
let window, local, runtime, assetRoot, closeReady = false, closing = false, closeTimer, smokeSignIn = false;
const trusted = (event) => window && event.sender === window.webContents &&
  event.senderFrame === window.webContents.mainFrame && isAppPage(event.senderFrame.url);
async function report(ok, details = '') {
  if (!smokeMode) return;
  await mkdir(smokeDir, { recursive: true });
  await writeFile(path.join(smokeDir, smokeMode + '.json'), JSON.stringify({ ok, details, version: app.getVersion() }));
}
async function openExternal(url) { const safe = externalLink(url); if (safe) await shell.openExternal(safe); }
async function closeDecision(message) {
  if (smokeMode) { await report(false, message); app.exit(1); return; }
  const choice = await dialog.showMessageBox(window, { type: 'warning', title: 'Slate', message,
    buttons: ['Return to Slate', 'Close anyway'], defaultId: 0, cancelId: 0 });
  if (choice.response === 1) { closeReady = true; window.close(); }
  else closing = false;
}
function createWindow() {
  window = new BrowserWindow({ title: 'Slate', width: 1280, height: 850, minWidth: 740, minHeight: 540, show: false,
    backgroundColor: '#f8fafc', icon: path.join(assetRoot, 'dist', 'icon-512.png'),
    webPreferences: { preload: path.join(app.getAppPath(), 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, backgroundThrottling: !smokeMode, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url).catch(() => {}); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url)) { event.preventDefault(); void openExternal(url).catch(() => {}); }
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => { if (closeReady) event.preventDefault(); });
  window.on('close', event => {
    if (closeReady || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (closing) return;
    closing = true; window.webContents.send('slate:request-close');
    closeTimer = setTimeout(() => void closeDecision("Slate hasn't finished saving. Return to the app to save or export your work."), 10000);
  });
  window.on('closed', () => { clearTimeout(closeTimer); window = undefined; });
  window.once('ready-to-show', () => { if (!smokeMode) window.show(); });
  return window.loadURL(DESKTOP_ORIGIN + '/');
}
ipcMain.handle('slate:sign-in', async (event, value) => {
  if (!trusted(event) || typeof value !== 'string') throw Error('Sign-in must start from Slate.');
  const ticket = signInTicket(value);
  const destination = providerLink(runtime.authorize(ticket));
  if (smokeMode) { smokeSignIn = true; return; }
  await shell.openExternal(destination);
});
ipcMain.on('slate:close-ready', async (event, saved) => {
  if (!trusted(event) || !closing || typeof saved !== 'boolean') return;
  clearTimeout(closeTimer);
  if (!saved) { await closeDecision('Your latest changes could not be saved. Return to Slate to export your work before closing.'); return; }
  closeReady = true;
  if (smokeMode) await report(true, 'Desktop loaded; isolated renderer and local helper verified; close save completed.');
  window.close();
});
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { void local?.close(); });
if (!firstInstance) app.quit();
// ESM must finish loading before Electron can emit ready.
else void app.whenReady().then(async () => {
  const source = app.isPackaged ? app.getAppPath() : path.resolve(app.getAppPath(), '..');
  const { createLocalServer } = await import(pathToFileURL(path.join(source, 'server', 'local-server.mjs')).href);
  const { ChatGPTRuntime } = await import(pathToFileURL(path.join(source, 'server', 'chatgpt-auth.mjs')).href);
  assetRoot = source;
  runtime = new ChatGPTRuntime();
  local = createLocalServer({ root: path.join(source, 'dist'), runtime, contentSecurityPolicy: DESKTOP_CSP });
  await local.listen(4173);
  // Application files are bundled and work offline; keep workspace IndexedDB intact.
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === window?.webContents && isAppPage(contents.getURL()) && ['clipboard-sanitized-write', 'clipboard-write'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    contents === window?.webContents && isAppPage(contents.getURL()) && ['clipboard-sanitized-write', 'clipboard-write'].includes(permission));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [ { label: 'Settings and backups', click: () => window?.webContents.send('slate:open-settings') }, { type: 'separator' }, { role: 'close' } ] },
    { label: 'Edit', submenu: [ { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' } ] },
    { label: 'View', submenu: [ { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' } ] },
    { label: 'Help', submenu: [ { label: 'Download updates', click: () => void shell.openExternal('https://github.com/owuorbruce/myself-/releases/latest') },
      { label: 'About Slate', click: () => void dialog.showMessageBox(window, { type: 'info', title: 'Slate', message: 'Slate ' + app.getVersion(), detail: 'Your notes, projects and study cards. Notes work offline; ChatGPT needs an internet connection.' }) } ] },
  ]));
  await createWindow();
  if (smokeMode) {
    const { runSmoke } = await import('./smoke.mjs');
    await runSmoke(window, smokeMode);
    if (smokeMode === "read" && !smokeSignIn) throw Error("Desktop sign-in did not reach the validated browser handoff.");
    window.close();
  }
}).catch(async error => {
  if (smokeMode) { await report(false, error.message); app.exit(1); return; }
  dialog.showErrorBox('Slate could not start', error.code === 'EADDRINUSE' ? 'Close any old Slate launcher window, then open the Slate app again.' : 'Please close Slate and try again. If the problem continues, reinstall the latest app.');
  await local?.close(); app.quit();
});
