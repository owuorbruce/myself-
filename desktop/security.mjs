export const DESKTOP_ORIGIN = 'http://localhost:4173';
export const DESKTOP_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
export function isAppPage(value, origin = DESKTOP_ORIGIN) {
  try { const url = new URL(value); return url.origin === origin && !url.username && !url.password && ['/', '/index.html'].includes(url.pathname); }
  catch { return false; }
}
export function externalLink(value) {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
export function signInTicket(value, origin = DESKTOP_ORIGIN) {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.pathname !== '/api/chatgpt/authorize' || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some(k => k !== 'ticket') || url.searchParams.getAll('ticket').length !== 1 ||
      !/^[a-zA-Z0-9_-]{43}$/.test(url.searchParams.get('ticket') || '')) throw Error();
    return url.searchParams.get('ticket');
  } catch { throw Error('Invalid Slate sign-in link.'); }
}
export function providerLink(value) {
  const url = new URL(value);
  if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize' || url.username || url.password)
    throw Error('Unexpected ChatGPT sign-in destination.');
  return url.href;
}
