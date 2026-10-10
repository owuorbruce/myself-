const { contextBridge, ipcRenderer } = require('electron');
let closeHandler;
contextBridge.exposeInMainWorld('slateDesktop', {
  onMcpCall: (handler) => {
    if (typeof handler !== 'function') throw new TypeError('An MCP handler is required.');
    const listener = (_event, request) => {
      Promise.resolve().then(() => handler(request.name, request.args)).then(
        value => ipcRenderer.send('slate:mcp-result', request.id, { value }),
        error => ipcRenderer.send('slate:mcp-result', request.id, { error: String(error?.message || error) })
      );
    };
    ipcRenderer.on('slate:mcp-call', listener);
    return () => ipcRenderer.removeListener('slate:mcp-call', listener);
  },
  openSignIn: (url) => ipcRenderer.invoke('slate:sign-in', url),
  onBeforeClose: (handler) => {
    if (typeof handler !== 'function') throw new TypeError('A close handler is required.');
    closeHandler = handler;
    return () => { if (closeHandler === handler) closeHandler = undefined; };
  },
});
ipcRenderer.on('slate:request-close', async () => {
  try { ipcRenderer.send('slate:close-ready', closeHandler ? (await closeHandler()) === true : true); }
  catch { ipcRenderer.send('slate:close-ready', false); }
});
ipcRenderer.on('slate:open-settings', () => window.dispatchEvent(new Event('slate-open-settings')));
