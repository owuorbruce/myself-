import { useCallback, useEffect, useRef, useState } from "react";
import { aiModels, aiProviders, learnedNoTools, savedChoice, type AIAccount, type AIModel, type AIProvider, type Choice } from "./ai";

/** One heading in the model picker, like "Qwen" or "Qwen (local)". */
export type ModelGroup = {
  key: string;
  account: string;
  label: string;
  local: boolean;
  models: AIModel[];
  error: string;
  loading: boolean;
};

const QWEN_LOCAL = /^qwen/i;
/** Newer local Qwen first. */
function qwenRank(id: string) {
  const v = id.match(/^qwen(\d+(?:\.\d+)?)/i)?.[1];
  return v ? -Number(v) : 0;
}

let cache: { at: number; groups: ModelGroup[]; providers: AIProvider[]; accounts: AIAccount[]; chatgpt: boolean } | null = null;

/** Loads every connected provider's models from its own API. */
export function useModelCatalog(enabled: boolean) {
  const [state, setState] = useState(cache);
  const [error, setError] = useState("");
  const run = useRef(0);
  const load = useCallback(async (force = false) => {
    if (!enabled) return;
    if (!force && cache && Date.now() - cache.at < 120000) { setState(cache); return; }
    const turn = ++run.current;
    try {
      const info = await aiProviders();
      const accounts: { id: string; type: string; label: string; local: boolean }[] = info.accounts.map((a) => ({
        id: a.id, type: a.type, label: a.name, local: !!info.providers.find((p) => p.type === a.type)?.local,
      }));
      if (info.chatgpt.connected) accounts.push({ id: "chatgpt", type: "chatgpt", label: "ChatGPT", local: false });
      if (!accounts.some((a) => a.type === "ollama")) accounts.push({ id: "ollama", type: "ollama", label: "Ollama", local: true });
      const pending = accounts.map((a): ModelGroup => ({ key: a.id, account: a.id, label: a.label, local: a.local, models: [], error: "", loading: true }));
      const base = { providers: info.providers, accounts: info.accounts, chatgpt: info.chatgpt.connected };
      setState({ at: Date.now(), groups: pending, ...base });
      const groups = (await Promise.all(accounts.map(async (a): Promise<ModelGroup[]> => {
        try {
          const models = await aiModels(a.id);
          if (a.type !== "ollama") return [{ key: a.id, account: a.id, label: a.label, local: a.local, models, error: "", loading: false }];
          // Local Qwen models get their own heading.
          const qwen = models.filter((m) => QWEN_LOCAL.test(m.id)).sort((x, y) => qwenRank(x.id) - qwenRank(y.id));
          const other = models.filter((m) => !QWEN_LOCAL.test(m.id));
          return [
            ...(qwen.length ? [{ key: a.id + ":qwen", account: a.id, label: "Qwen (local)", local: true, models: qwen, error: "", loading: false }] : []),
            ...(other.length || !qwen.length ? [{ key: a.id, account: a.id, label: "Ollama", local: true, models: other, error: "", loading: false }] : []),
          ];
        } catch (e) {
          return [{ key: a.id, account: a.id, label: a.label, local: a.local, models: [], error: e instanceof Error ? e.message : "Couldn't load models.", loading: false }];
        }
      }))).flat();
      if (turn !== run.current) return;
      cache = { at: Date.now(), groups, ...base };
      setState(cache);
      setError("");
    } catch (e) {
      if (turn === run.current) setError(e instanceof Error ? e.message : "Couldn't reach the Slate helper.");
    }
  }, [enabled]);
  useEffect(() => {
    void load();
    const refresh = () => void load(true);
    window.addEventListener("slate-ai-providers", refresh);
    window.addEventListener("slate-chatgpt", refresh);
    return () => {
      window.removeEventListener("slate-ai-providers", refresh);
      window.removeEventListener("slate-chatgpt", refresh);
    };
  }, [load]);
  return { groups: state?.groups || [], providers: state?.providers || [], error, reload: () => load(true), loaded: !!state };
}

export function toolSupport(groups: ModelGroup[], choice: Choice | null): boolean | null {
  if (!choice) return null;
  if (learnedNoTools().has(choice.account + "::" + choice.model)) return false;
  return groups.find((g) => g.account === choice.account)?.models.find((m) => m.id === choice.model)?.tools ?? null;
}

/**
 * The model to use: the last pick if it's still offered, else Qwen (the default
 * for new conversations), else Mistral, else anything. Offline, only local
 * models count, local Qwen first.
 */
export function defaultChoice(groups: ModelGroup[], providers: AIProvider[], online: boolean): Choice | null {
  const usable = groups.filter((g) => (online || g.local) && g.models.length);
  const has = (c: Choice | null) => !!c && usable.some((g) => g.account === c.account && g.models.some((m) => m.id === c.model));
  const saved = savedChoice();
  if (has(saved)) return saved;
  if (!online) {
    const qwen = usable.find((g) => g.label === "Qwen (local)");
    const group = qwen || usable[0];
    return group ? { account: group.account, model: group.models[0].id } : null;
  }
  for (const type of ["qwen", "mistral"]) {
    const group = usable.find((g) => g.account === type);
    if (!group) continue;
    const pattern = providers.find((p) => p.type === type)?.preferredModel;
    const preferred = pattern ? group.models.find((m) => new RegExp(pattern).test(m.id)) : undefined;
    return { account: type, model: (preferred || group.models[0]).id };
  }
  const first = usable.find((g) => !g.local) || usable[0];
  return first ? { account: first.account, model: first.models[0].id } : null;
}
