import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { aiProviders, aiModels, checkTools, localAI, removeProvider, saveProvider, rememberNoTools, type AIAccount, type AIProvider } from "./ai";
import { ChatGPTConnection, LocalSetup } from "./ChatGPTUI";

const changed = () => window.dispatchEvent(new Event("slate-ai-providers"));
const BUILT_IN = ["qwen", "mistral", "gemini", "anthropic"];

/** Settings & backups → AI providers. */
export function AISettings({ onExport }: { onExport: () => void }) {
  const local = localAI();
  const [info, setInfo] = useState<{ providers: AIProvider[]; accounts: AIAccount[] } | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    try { const next = await aiProviders(); setInfo(next); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't reach the Slate helper."); }
  };
  useEffect(() => {
    if (!local) return;
    void load();
    window.addEventListener("slate-ai-providers", load);
    return () => window.removeEventListener("slate-ai-providers", load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  if (!local) return <div className="settings-section">
    <h2>AI providers</h2>
    <LocalSetup onExport={onExport} />
  </div>;
  const provider = (type: string) => info?.providers.find((p) => p.type === type);
  return <div className="settings-section ai-settings">
    <h2>AI providers</h2>
    <p className="small">Connect the AIs you want to use in <b>Ask AI</b>. Qwen is the default for new conversations. Keys are saved by the Slate helper on this computer (<code>~/.slate/ai</code>), outside your workspace and backups, and each key is only ever sent to its own provider.</p>
    {error && <p className="chatgpt-error" role="alert">{error} <button onClick={() => void load()}>Try again</button></p>}
    {info && <>
      {BUILT_IN.map((type) => provider(type) && <KeyProvider key={type} provider={provider(type)!} account={info.accounts.find((a) => a.id === type)} />)}
      <details className="ai-provider">
        <summary><span>ChatGPT</span><span className="ai-status">plan sign-in</span></summary>
        <ChatGPTConnection onExport={onExport} />
      </details>
      {provider("ollama") && <OllamaProvider provider={provider("ollama")!} account={info.accounts.find((a) => a.id === "ollama")} />}
      {provider("openai-compatible") && <CustomProviders provider={provider("openai-compatible")!} accounts={info.accounts.filter((a) => a.type === "openai-compatible")} />}
    </>}
  </div>;
}

function Status({ account }: { account?: AIAccount }) {
  return account?.hasKey ? <span className="ai-status on"><Check size={13} /> Connected · key {account.keyHint}</span> : <span className="ai-status">Not connected</span>;
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); setMessage(done); changed(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work."); }
    finally { setBusy(false); }
  };
  return { busy, message, error, run };
}

function KeyProvider({ provider, account }: { provider: AIProvider; account?: AIAccount }) {
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl || provider.defaultBaseUrl);
  useEffect(() => { setBaseUrl(account?.baseUrl || provider.defaultBaseUrl); }, [account?.baseUrl, provider.defaultBaseUrl]);
  const saver = useSaver();
  const region = provider.regions.find((r) => r.baseUrl === baseUrl)?.id || "custom";
  return <details className="ai-provider" open={provider.type === "qwen" && !account}>
    <summary><span>{provider.label}{provider.type === "qwen" ? " (default)" : ""}</span><Status account={account} /></summary>
    <form onSubmit={(e) => { e.preventDefault(); void saver.run(async () => { await saveProvider({ type: provider.type, apiKey: key, ...(provider.editableBaseUrl ? { baseUrl } : {}) }); setKey(""); }, "Saved"); }}>
      {provider.editableBaseUrl && <>
        <label>Region
          <select value={region} onChange={(e) => { const r = provider.regions.find((x) => x.id === e.target.value); if (r) setBaseUrl(r.baseUrl); }}>
            {provider.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            <option value="custom">Workspace or other address…</option>
          </select>
        </label>
        <label>Address
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </label>
        <p className="small">Keys only work with their own region's address. If your Model Studio console shows a workspace address (like <code>https://&lt;workspace&gt;.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1</code>), paste it here.</p>
      </>}
      <label>API key
        <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
          placeholder={account?.hasKey ? "Saved. Paste a new key to replace it." : "Paste your API key"} />
      </label>
      <div className="chatgpt-actions">
        <button className="primary" disabled={saver.busy || (!key.trim() && !(account?.hasKey && provider.editableBaseUrl))}>Save</button>
        {account && <button type="button" disabled={saver.busy} onClick={() => void saver.run(() => removeProvider(account.id), "Removed")}>Remove</button>}
        {provider.keyUrl && <a className="chatgpt-usage" href={provider.keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink size={13} /></a>}
      </div>
      {account?.hasKey && <ToolCheck account={account.id} />}
      {saver.message && <p className="small" role="status">{saver.message}</p>}
      {saver.error && <p className="chatgpt-error" role="alert">{saver.error}</p>}
    </form>
  </details>;
}

/** Loads the models and checks one for tool calling with a tiny real request. */
function ToolCheck({ account }: { account: string }) {
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [model, setModel] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const list = async () => {
    setResult("");
    try { const m = await aiModels(account); setModels(m); setModel(m[0]?.id || ""); setResult(`${m.length} models available.`); }
    catch (e) { setResult(e instanceof Error ? e.message : "Couldn't load models."); }
  };
  const check = async () => {
    setBusy(true); setResult("");
    try {
      const r = await checkTools(account, model);
      rememberNoTools(account, model, !r.tools);
      setResult(r.tools ? `${model} can use your notes (tool calling works).` : `${model} can't call tools, so it's marked "answers only".`);
      changed();
    } catch (e) { setResult(e instanceof Error ? e.message : "The check didn't work."); }
    finally { setBusy(false); }
  };
  return <div className="ai-check">
    {!models ? <button type="button" onClick={() => void list()}>Load models</button> : <>
      <select aria-label="Model to check" value={model} onChange={(e) => setModel(e.target.value)}>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button type="button" disabled={busy || !model} onClick={() => void check()}>{busy ? "Checking…" : "Check tool calling"}</button>
    </>}
    {result && <p className="small" role="status">{result}</p>}
  </div>;
}

function OllamaProvider({ provider, account }: { provider: AIProvider; account?: AIAccount }) {
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl || provider.defaultBaseUrl);
  const [state, setState] = useState("Checking…");
  const saver = useSaver();
  useEffect(() => {
    let stop = false;
    aiModels("ollama").then((m) => {
      if (stop) return;
      const qwen = m.filter((x) => /^qwen/i.test(x.id));
      setState(m.length ? `Running · ${m.length} model${m.length === 1 ? "" : "s"}` + (qwen.length ? ` · Qwen (local): ${qwen[0].id}` : " · no Qwen model yet") : "Running · no models yet");
    }, (e) => { if (!stop) setState(e instanceof Error ? e.message : "Not running"); });
    return () => { stop = true; };
  }, [account?.baseUrl, saver.message]);
  return <details className="ai-provider">
    <summary><span>Ollama (on this computer)</span><span className="ai-status">{state}</span></summary>
    <p className="small">Runs models on your own computer, with no key, and works offline. A local Qwen model is used when you're offline: install <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama</a>, then run <code>ollama pull qwen3.5:4b</code> (or <code>qwen3.5:9b</code> on a stronger computer).</p>
    <form onSubmit={(e) => { e.preventDefault(); void saver.run(() => saveProvider({ type: "ollama", baseUrl }), "Saved"); }}>
      <label>Address <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} /></label>
      <div className="chatgpt-actions"><button disabled={saver.busy}>Save address</button></div>
      {saver.error && <p className="chatgpt-error" role="alert">{saver.error}</p>}
    </form>
  </details>;
}

function CustomProviders({ provider, accounts }: { provider: AIProvider; accounts: AIAccount[] }) {
  const [preset, setPreset] = useState(provider.presets[0]?.id || "custom");
  const chosen = provider.presets.find((p) => p.id === preset);
  const [name, setName] = useState(chosen?.name || "");
  const [baseUrl, setBaseUrl] = useState(chosen?.baseUrl || "");
  const [key, setKey] = useState("");
  const saver = useSaver();
  return <details className="ai-provider">
    <summary><span>OpenAI-compatible services</span><span className="ai-status">{accounts.length ? `${accounts.length} connected` : "None yet"}</span></summary>
    {accounts.map((a) => <div key={a.id} className="ai-custom-row">
      <span><b>{a.name}</b> <span className="small">{a.baseUrl}</span></span>
      <Status account={a} />
      <button type="button" onClick={() => void saver.run(() => removeProvider(a.id), "Removed")}>Remove</button>
    </div>)}
    <form onSubmit={(e) => { e.preventDefault(); void saver.run(async () => { await saveProvider({ type: provider.type, name, baseUrl, apiKey: key }); setKey(""); }, "Added"); }}>
      <label>Service
        <select value={preset} onChange={(e) => { setPreset(e.target.value); const p = provider.presets.find((x) => x.id === e.target.value); setName(p?.name || ""); setBaseUrl(p?.baseUrl || ""); }}>
          {provider.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="custom">Other…</option>
        </select>
      </label>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Address <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} /></label>
      <label>API key <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></label>
      <div className="chatgpt-actions">
        <button className="primary" disabled={saver.busy || !name.trim() || !baseUrl.trim() || !key.trim()}>Add</button>
        {chosen?.keyUrl && <a className="chatgpt-usage" href={chosen.keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink size={13} /></a>}
      </div>
      {saver.message && <p className="small" role="status">{saver.message}</p>}
      {saver.error && <p className="chatgpt-error" role="alert">{saver.error}</p>}
    </form>
  </details>;
}
