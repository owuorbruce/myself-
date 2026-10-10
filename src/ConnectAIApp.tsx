import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, RotateCcw } from "lucide-react";

const LOCAL_URL = "http://127.0.0.1:4173/mcp";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return <div className="mcp-copy">
    <div className="mcp-copy-head"><span>{label}</span>
      <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
        <Copy size={13} /> {done ? "Copied" : "Copy"}
      </button>
    </div>
    <pre>{text}</pre>
  </div>;
}

/** Settings & backups → Connect an AI app (MCP). Off by default. */
export function ConnectAIApp() {
  const bridge = window.slateDesktop?.mcp;
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [show, setShow] = useState(false);
  const [remote, setRemote] = useState("");
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<McpConfig>) => {
    setError("");
    try { const next = await fn(); setConfig(next); setRemote(next.remoteUrl); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That didn't work."); }
  };
  useEffect(() => {
    if (!bridge) return;
    void run(() => bridge.config());
    const timer = setInterval(() => void bridge.config().then(setConfig, () => {}), 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!bridge) return <div className="settings-section">
    <h2>Connect an AI app</h2>
    <p className="small">Let Claude, ChatGPT and other AI apps read and edit your notes through MCP. This works in the Slate desktop app, which runs the local server. A hosted server for claude.ai, ChatGPT and phones is described in <code>mcp-remote/DEPLOY.md</code>.</p>
  </div>;
  if (!config) return null;
  const token = config.token;
  const shown = show ? token : token.slice(0, 4) + "…" + token.slice(-4);
  const claudeCode = `claude mcp add --transport http slate ${LOCAL_URL} --header "Authorization: Bearer ${token}"`;
  const claudeDesktop = JSON.stringify({ mcpServers: { slate: {
    command: "npx", args: ["-y", "mcp-remote", LOCAL_URL, "--allow-http", "--header", "Authorization:${SLATE_AUTH}"],
    env: { SLATE_AUTH: "Bearer " + token },
  } } }, null, 2);
  const remoteMcp = config.remoteUrl ? config.remoteUrl + "/mcp" : "https://slate-mcp.<your-account>.workers.dev/mcp";
  return <div className="settings-section mcp-settings">
    <h2>Connect an AI app</h2>
    <p className="small">Let Claude, ChatGPT and other AI apps search, read and add to your notes, like Notion's MCP server. They can create pages, add to or rewrite a page, and add tasks; every change keeps a snapshot in Page history. Nothing can be deleted.</p>
    <label className="mcp-toggle">
      <input type="checkbox" checked={config.enabled} onChange={(e) => void run(() => bridge.set({ enabled: e.target.checked }))} />
      Let AI apps on this computer use my notes
    </label>
    {error && <p className="chatgpt-error" role="alert">{error}</p>}
    {config.enabled && <>
      <h3>On this computer</h3>
      <p className="small">Address <code>{LOCAL_URL}</code>. It only answers apps on this computer that send this token, and only while Slate is open.</p>
      <div className="mcp-token">
        <span>Access token</span>
        <code>{shown}</code>
        <button type="button" aria-label={show ? "Hide token" : "Show token"} onClick={() => setShow((s) => !s)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(token)}><Copy size={14} /> Copy</button>
        <button type="button" onClick={() => { if (confirm("Make a new token? Apps using the old one will stop working until you update them.")) void run(() => bridge.regenerate()); }}><RotateCcw size={14} /> Regenerate</button>
      </div>
      <details>
        <summary>Claude Code</summary>
        <p className="small">Run this in a terminal:</p>
        <CopyBlock label="Command" text={claudeCode} />
      </details>
      <details>
        <summary>Claude Desktop</summary>
        <p className="small">Needs <a href="https://nodejs.org/" target="_blank" rel="noreferrer">Node.js</a>. In Claude Desktop open <b>Settings → Developer → Edit Config</b>, add this to <code>claude_desktop_config.json</code> (merge it with any servers already there), save and restart Claude Desktop.</p>
        <CopyBlock label="claude_desktop_config.json" text={claudeDesktop} />
      </details>
    </>}
    <h3>From anywhere (claude.ai, ChatGPT, phones)</h3>
    <p className="small">These apps can only reach a public HTTPS server that you sign in to. Deploy the small Slate server in <code>mcp-remote/</code> to Cloudflare (free) by following <code>mcp-remote/DEPLOY.md</code>. It works with your private sync repository, so changes arrive on your next sync.</p>
    <form className="mcp-remote" onSubmit={(e) => { e.preventDefault(); void run(() => bridge.set({ remoteUrl: remote })); }}>
      <label>Remote server address
        <input value={remote} placeholder="https://slate-mcp.<your-account>.workers.dev" onChange={(e) => setRemote(e.target.value)} spellCheck={false} />
      </label>
      <button disabled={remote.trim() === config.remoteUrl}>Save</button>
    </form>
    <details>
      <summary>claude.ai</summary>
      <p className="small">Open <b>Settings → Connectors → Add custom connector</b>, name it Slate, paste the address below and press <b>Add</b>. Sign in with GitHub when asked; only your GitHub account is allowed.</p>
      <CopyBlock label="Server URL" text={remoteMcp} />
    </details>
    <details>
      <summary>ChatGPT developer mode</summary>
      <p className="small">Developer mode needs a Plus or Pro plan. Open <b>Settings → Apps &amp; Connectors → Advanced settings</b> and turn on <b>Developer mode</b>. Then choose <b>Create</b>, name it Slate, paste the address below, choose <b>OAuth</b> and create it. Sign in with GitHub when asked.</p>
      <CopyBlock label="MCP server URL" text={remoteMcp} />
    </details>
    {config.remoteUrl && <p className="small">Calls to the remote server are listed at <a href={config.remoteUrl + "/activity"} target="_blank" rel="noreferrer">{config.remoteUrl}/activity</a> after you sign in.</p>}
    <h3>Recent calls on this computer</h3>
    {config.log.length ? <ul className="mcp-log">
      {[...config.log].reverse().slice(0, 20).map((entry, i) => <li key={i}><code>{entry.tool}</code> <span>{new Date(entry.at).toLocaleString()}</span></li>)}
    </ul> : <p className="small">No calls yet.</p>}
  </div>;
}
