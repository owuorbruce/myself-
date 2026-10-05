import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, ExternalLink, LoaderCircle, Plus, Square } from "lucide-react";
import {
  localChatGPT, chatGPTSession, signInChatGPT, signOutChatGPT, selectChatGPTAccount,
  chatGPTModels, askChatGPT, type ChatGPTSession, type ChatGPTModel, type ChatMessage,
} from "./chatgpt";
import { flashcardsFromAnswer } from "./ai-response.mjs";

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

function LocalSetup({ onExport }: { onExport?: () => void }) {
  return <div className="chatgpt-local-setup">
    <p>Use your ChatGPT plan in the Slate desktop app.</p>
    <ol>
      <li>Export your workspace here if you want to bring these notes with you.</li>
      <li><a href={DOWNLOAD}>Download Slate for Windows</a> and run the installer.</li>
      <li>Open <b>Slate</b> from your desktop or Start menu.</li>
      <li>Restore your backup in <b>Settings &amp; backups</b>, then choose <b>Continue with ChatGPT</b>.</li>
    </ol>
    {onExport && <button onClick={onExport}>Export your workspace</button>}
    <p className="small">Keep Slate open while using ChatGPT. Sign-in uses your browser; eligible requests use your plan allowance or available credits.</p>
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

export function ChatGPTSettings({ onExport }: { onExport: () => void }) {
  const connection = useConnection();
  return <div className="settings-section">
    <h2>ChatGPT in Slate</h2>
    <ConnectionControls connection={connection} onExport={onExport} />
    <p className="small">When you press Ask ChatGPT, the selected notes are sent to OpenAI. Sign-in credentials stay in the local helper on your computer and are excluded from workspace backups.</p>
  </div>;
}

export function ChatGPTPanel({ prompt, action, onSave, onCards, onExport }: {
  prompt: string; action: string; onSave: (text: string) => void;
  onCards: (cards: { question: string; answer: string }[]) => void; onExport: () => void;
}) {
  const connection = useConnection();
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [modelError, setModelError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [followup, setFollowup] = useState("");
  const [resultAction, setResultAction] = useState("");
  const [notice, setNotice] = useState("");
  const [modelVersion, setModelVersion] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    controller.current?.abort(); generation.current++; setBusy(false);
    setComplete(false); setAnswer(""); setMessages([]); setModelError(""); setModels([]); setModel("");
    let stopped = false;
    if (connection.session?.planEnabled) void chatGPTModels().then((list) => {
      if (!stopped) { setModels(list); setModel(list[0]?.id || ""); if (!list.length) setModelError("No models are available to this ChatGPT account."); }
    }).catch((e) => { if (!stopped) setModelError(e.message || "Couldn't load ChatGPT models."); });
    return () => { stopped = true; };
  }, [connection.session?.active, connection.session?.planEnabled, modelVersion]);
  const send = async (follow = false) => {
    if (busy || !model || !connection.session?.planEnabled) return;
    const requestMessages: ChatMessage[] = follow
      ? [...messages, { role: "user", content: followup.trim() }]
      : [{ role: "user", content: prompt }];
    if (follow && !followup.trim()) return;
    const turn = ++generation.current;
    const aborter = new AbortController(); controller.current = aborter;
    setBusy(true); setAnswer(""); setComplete(false); setError(""); setNotice("");
    const requestedAction = follow ? resultAction : action;
    try {
      const result = await askChatGPT(model, requestMessages, (text) => {
        if (active.current && generation.current === turn) setAnswer(text);
      }, aborter.signal);
      if (active.current && generation.current === turn) {
        setAnswer(result); setComplete(true); setResultAction(requestedAction);
        setMessages([...requestMessages, { role: "assistant", content: result }]); setFollowup("");
      }
    } catch (e) {
      if (active.current && generation.current === turn) setError(aborter.signal.aborted ? "Request stopped. The partial answer hasn't been saved." : e instanceof Error ? e.message : "Couldn't finish the answer.");
    } finally { if (active.current && generation.current === turn) setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(answer); setNotice("Answer copied"); }
    catch { setError("Clipboard unavailable. Select and copy the answer."); }
  };
  const addCards = () => {
    try { const cards = flashcardsFromAnswer(answer); onCards(cards); setNotice(`${cards.length} flashcards added`); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't read the flashcards."); }
  };
  return <div className="chatgpt-panel">
    <ConnectionControls connection={connection} onExport={onExport} />
    {connection.session?.planEnabled && <>
      <label>ChatGPT model
        <select aria-label="ChatGPT model" value={model} disabled={busy || !models.length} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      {modelError && <><p className="chatgpt-error" role="alert">{modelError}</p><button onClick={() => setModelVersion((v) => v + 1)}>Reload models</button></>}
      <p className="small">Pressing Ask ChatGPT sends the selected notes and question to OpenAI using your ChatGPT plan.</p>
      <button className="primary" disabled={busy || !model} onClick={() => void send()}>
        {busy ? <LoaderCircle size={16} className="chatgpt-spinner" /> : <ArrowUp size={16} />}
        {busy ? "ChatGPT is answering…" : "Ask ChatGPT"}
      </button>
      {busy && <button onClick={() => controller.current?.abort()}><Square size={14} /> Stop</button>}
      {(answer || error) && <div className="chatgpt-answer" aria-busy={busy}>
        <h4>{complete ? "ChatGPT answer" : busy ? "Writing…" : "Answer incomplete"}</h4>
        {answer && <div className="chatgpt-answer-text" tabIndex={0}>{answer}</div>}
        {error && <p className="chatgpt-error" role="alert">{error}</p>}
        {complete && <>
          <div className="chatgpt-actions">
            <button onClick={() => { onSave(answer); setNotice("Answer saved as a new note"); }}><Plus size={14} /> Save as new note</button>
            <button onClick={() => void copy()}><Copy size={14} /> Copy answer</button>
            {resultAction === "Flashcards" && <button onClick={addCards}>Add these flashcards</button>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void send(true); }} className="chatgpt-followup">
            <label>Follow-up question<textarea aria-label="Follow-up question" rows={2} value={followup} onChange={(e) => setFollowup(e.target.value)} disabled={busy} /></label>
            <button type="submit" disabled={busy || !followup.trim()}>Send follow-up</button>
          </form>
        </>}
        {notice && <p role="status" className="small">{notice}</p>}
      </div>}
    </>}
  </div>;
}
