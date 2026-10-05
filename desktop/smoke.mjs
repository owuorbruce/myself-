// Runs only with --slate-smoke and an isolated SLATE_SMOKE_DIR; no live account is used.
export async function runSmoke(window, mode) {
  const checks = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 150 && !document.querySelector('[aria-label="Quick capture"]'); i++) await new Promise(r => setTimeout(r, 100));
    if (!document.querySelector('[aria-label="Quick capture"]')) throw Error('Workspace UI did not load.');
    if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw Error('Node leaked into renderer.');
    if (typeof window.slateDesktop?.openSignIn !== 'function' || typeof window.slateDesktop?.onBeforeClose !== 'function') throw Error('Desktop bridge missing.');
    const status = await (await fetch('/api/chatgpt/session')).json();
    if (!status.available || status.connected || 'accessToken' in status) throw Error('Unexpected local helper status.');
    return true;
  })()`);
  if (!checks) throw Error('Desktop checks failed.');
  if (mode === 'write') {
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('[aria-label="Quick capture"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Desktop save test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 10));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 10));
    })()`);
  } else {
    const persisted = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const request = indexedDB.open('slate-workspace', 2);
      request.onerror = () => reject(Error('Workspace could not reopen.'));
      request.onsuccess = () => { const db = request.result; const read = db.transaction('workspace').objectStore('workspace').get('main');
        read.onsuccess = () => { resolve(read.result?.data?.pages?.some(p => p.title === 'Desktop save test')); db.close(); };
        read.onerror = () => reject(Error('Saved workspace could not be read.'));
      };
    })`);
    if (!persisted) throw Error('Note created immediately before closing did not survive restart.');
    await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Settings & backups')); if (!button) throw Error('Settings navigation missing.'); button.click(); })()`);
    const connectedUI = await window.webContents.executeJavaScript(`(async () => {
      for (let i=0;i<100;i++) { if ([...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Continue with ChatGPT')) return true; await new Promise(r => setTimeout(r,100)); }
      return false;
    })()`);
    if (!connectedUI) throw Error('ChatGPT sign-in control missing in the packaged app.');
    await window.webContents.executeJavaScript(`(async () => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continue with ChatGPT');
      button.click(); await new Promise(r => setTimeout(r, 500));
    })()`);
  }
}
