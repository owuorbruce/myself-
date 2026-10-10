const { contextBridge, ipcRenderer } = require('electron');
let closeHandler, mcpHandler;
contextBridge.exposeInMainWorld('slateDesktop', {
  openSignIn: (url) => ipcRenderer.invoke('slate:sign-in', url),
  onBeforeClose: (handler) => {
    if (typeof handler !== 'function') throw new TypeError('A close handler is required.');
    closeHandler = handler;
    return () => { if (closeHandler === handler) closeHandler = undefined; };
  },
  mcp: {
    config: () => ipcRenderer.invoke('slate:mcp-config'),
    set: (patch) => ipcRenderer.invoke('slate:mcp-set', { ...(typeof patch?.enabled === 'boolean' ? { enabled: patch.enabled } : {}), ...(typeof patch?.remoteUrl === 'string' ? { remoteUrl: patch.remoteUrl } : {}) }),
    regenerate: () => ipcRenderer.invoke('slate:mcp-regenerate'),
    /** The page runs tool calls from AI apps; one handler at a time. */
    onCall: (handler) => {
      if (typeof handler !== 'function') throw new TypeError('An MCP handler is required.');
      mcpHandler = handler;
      ipcRenderer.send('slate:mcp-ready');
      return () => { if (mcpHandler === handler) mcpHandler = undefined; };
    },
  },
});
ipcRenderer.on('slate:request-close', async () => {
  try { ipcRenderer.send('slate:close-ready', closeHandler ? (await closeHandler()) === true : true); }
  catch { ipcRenderer.send('slate:close-ready', false); }
});
ipcRenderer.on('slate:open-settings', () => window.dispatchEvent(new Event('slate-open-settings')));
ipcRenderer.on('slate:mcp-call', async (_event, request) => {
  if (!request || typeof request.id !== 'string') return;
  if (!mcpHandler) { ipcRenderer.send('slate:mcp-result', request.id, { error: 'Open Slate first: the Slate window is still loading.' }); return; }
  try { ipcRenderer.send('slate:mcp-result', request.id, { value: await mcpHandler(String(request.name), request.args) }); }
  catch (error) { ipcRenderer.send('slate:mcp-result', request.id, { error: String(error?.message || error) }); }
});
