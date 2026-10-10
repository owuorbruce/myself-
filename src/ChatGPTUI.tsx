import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import {
  localChatGPT, chatGPTSession, signInChatGPT, signOutChatGPT, selectChatGPTAccount, type ChatGPTSession,
} from "./chatgpt";

const DOWNLOAD = "https://github.com/owuorbruce/myself-/releases/latest/download/Slate-Setup.exe";
const USAGE = "https://chatgpt.com/";
function changed() { window.dispatchEvent(new Event("slate-chatgpt")); }
function useConnection() {
  const local = localChatGPT();
  const [session, setSession] = useState<ChatGPTSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(local);
  const inProgress = useRef(false);
  const alive = useRef(true);
  const refresh = async () => {
    if (!local || inProgress.current) return;
    inProgress.current = true;
    try {
      const next = await chatGPTSession();
      if (alive.current) { setSession(next); setError(""); }
    } catch (e) {
      if (alive.current) { setSession(null); setError(e instanceof Error ? e.message : "Couldn't reach the local helper."); }
    } finally { inProgress.current = false; if (alive.current) setChecking(false); }
  };
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = local ? setInterval(() => void refresh(), 2500) : null;
    const listener = () => void refresh(); window.addEventListener("slate-chatgpt", listener);
    return () => { alive.current = false; if (timer) clearInterval(timer); window.removeEventListener("slate-chatgpt", listener); };
  }, [local]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); changed(); await refresh(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Couldn't connect ChatGPT."); }
    finally { if (alive.current) setBusy(false); }
  };
  return { local, session, error, busy, checking, action, refresh };
}

export function LocalSetup({ onExport }: { onExport?: () => void }) {
  return <div className="chatgpt-local-setup">
    <p>Ask AI and AI providers work in the Slate desktop app (or the local launcher).</p>
    <ol>
      <li>Export your workspace here if you want to bring these notes with you.</li>
      <li><a href={DOWNLOAD}>Download Slate for Windows</a> and run the installer.</li>
      <li>Open <b>Slate</b> from your desktop or Start menu.</li>
      <li>Restore your backup in <b>Settings &amp; backups</b>, then connect an AI under <b>AI providers</b>.</li>
    </ol>
    {onExport && <button onClick={onExport}>Export your workspace</button>}
    <p className="small">Keep Slate open while using AI. API keys and the ChatGPT sign-in are kept by the Slate helper on your computer.</p>
  </div>;
}

type Connection = ReturnType<typeof useConnection>;
function ConnectionControls({ connection, onExport }: { connection: Connection; onExport?: () => void }) {
  const { local, session, error, busy, checking, action } = connection;
  if (!local) return <LocalSetup onExport={onExport} />;
  if (checking && !session) return <p className="small">Checking ChatGPT connection…</p>;
  if (!session) return <div className="chatgpt-connection">
    <p>Start Slate with its local launcher to connect your ChatGPT plan.</p>
    {error && <p role="alert" className="chatgpt-error">{error}</p>}
    <button onClick={() => void connection.refresh()}>Check connection</button>
  </div>;
  return <div className="chatgpt-connection">
    {session.connected ? <>
      <p className="chatgpt-account"><Check size={15} /> {session.account || "ChatGPT connected"}</p>
      <p className="small">{session.planEnabled ? "Using ChatGPT plan. Eligible usage is shared with your other apps." : "Signed in. Allow plan usage to receive answers inside Slate."}</p>
      {!session.planEnabled && <button className="primary" disabled={busy}
        onClick={() => void action(() => signInChatGPT({ enablePlan: true }))}>Continue with ChatGPT</button>}
      <div className="chatgpt-actions">
        <button disabled={busy} onClick={() => void action(() => signInChatGPT({ enablePlan: !session.planEnabled }))}>Reconnect</button>
        <button disabled={busy} onClick={() => void action(() => signInChatGPT({ newAccount: true }))}>Add another account</button>
        <button disabled={busy} onClick={() => void action(signOutChatGPT)}>Sign out</button>
      </div>
      <a className="chatgpt-usage" href={USAGE} target="_blank" rel="noreferrer">ChatGPT settings → Usage <ExternalLink size={13} /></a>
    </> : <>
      <p>Connect an eligible ChatGPT Plus or Pro account. No API key is needed.</p>
      <button className="primary" disabled={busy} onClick={() => void action(() => signInChatGPT({ enablePlan: true }))}>
        {busy ? "Opening sign-in…" : "Continue with ChatGPT"}
      </button>
    </>}
    {session.accounts.length > 1 && <label>Account
        <select aria-label="Connected ChatGPT account" value={session.active} disabled={busy}
          onChange={(e) => void action(() => selectChatGPTAccount(e.target.value))}>
          {session.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>}
    {session.pending && <p role="status" className="small">Finish sign-in in the browser tab. Slate will detect your connection.</p>}
    {(error || session.error) && <p role="alert" className="chatgpt-error">{error || session.error}</p>}
  </div>;
}

/** ChatGPT plan sign-in, shown in Settings & backups → AI providers. */
export function ChatGPTConnection({ onExport }: { onExport: () => void }) {
  const connection = useConnection();
  return <>
    <ConnectionControls connection={connection} onExport={onExport} />
    <p className="small">Sign-in credentials stay in the local helper on your computer and are excluded from workspace backups. Only the conversation and the notes you choose are sent to OpenAI.</p>
  </>;
}
