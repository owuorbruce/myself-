// AI providers and the accounts (API keys) saved for them.
//
// Each file in ./providers is one provider. It exports a default object:
//   type, label, needsKey, local?, custom?, signIn?, presets?, keyUrl?,
//   editableBaseUrl? and regions? (a built-in service whose address you choose)
//   listModels(account, { signal }) -> [{ id, name, tools: true | false | null }]
//   stream(account, { model, system, messages, tools, signal, onText })
//     -> { text, toolCalls: [{ id, name, arguments }], native? }
// Stopping is the abort signal. Adding another AI is one new file there.
import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileStore } from "../chatgpt-auth.mjs";
import { AIError } from "./http.mjs";
import { checkBaseUrl } from "./providers/openai-compatible.mjs";

let loading;
export function loadProviders() {
  loading ||= (async () => {
    const folder = new URL("./providers/", import.meta.url);
    const names = (await readdir(folder)).filter((n) => n.endsWith(".mjs")).sort();
    const list = [];
    for (const name of names) {
      const provider = (await import(new URL(name, folder).href)).default;
      if (provider?.type && typeof provider.listModels === "function" && typeof provider.stream === "function") list.push(provider);
    }
    return new Map(list.map((p) => [p.type, p]));
  })();
  return loading;
}

export function accountStore(directory = process.env.SLATE_AI_DIR || path.join(homedir(), ".slate", "ai")) {
  return fileStore(directory, { file: "providers.json", label: "AI provider keys" });
}

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

/** Saved provider accounts. Keys stay in this process and the credentials file. */
export class Accounts {
  constructor({ store = accountStore() } = {}) {
    this.store = store;
    this.queue = Promise.resolve();
  }
  async all() {
    const data = await this.store.read();
    if (data && (data.version !== 1 || !Array.isArray(data.accounts)))
      throw new AIError("The saved AI provider keys have an unsupported format.", "credential_storage", 500);
    return data?.accounts || [];
  }
  async get(id) {
    return (await this.all()).find((a) => a.id === id);
  }
  /** Public view: never includes a key. */
  static summary(a) {
    return { id: a.id, type: a.type, name: a.name, baseUrl: a.baseUrl || "", hasKey: !!a.apiKey,
      keyHint: a.apiKey ? "…" + a.apiKey.slice(-4) : "" };
  }
  exclusive(fn) {
    const work = this.queue.then(fn, fn);
    this.queue = work.catch(() => {});
    return work;
  }
  async save(input, providers) {
    return this.exclusive(async () => {
      const provider = providers.get(input?.type);
      if (!provider || provider.signIn) throw new AIError("Choose a provider to connect.", "invalid_provider");
      const accounts = await this.all();
      // Built-in providers have one account each; you can add many OpenAI-compatible ones.
      const id = provider.custom ? (typeof input.id === "string" && /^custom-[\w-]{6,40}$/.test(input.id) ? input.id : "custom-" + randomUUID()) : provider.type;
      const existing = accounts.find((a) => a.id === id);
      const apiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? clean(input.apiKey, 500) : existing?.apiKey || "";
      if (/\s/.test(apiKey)) throw new AIError("An API key can't contain spaces.", "invalid_key");
      if (provider.needsKey && !apiKey) throw new AIError(`Paste your ${provider.label} API key.`, "missing_key");
      const keyProblem = apiKey && provider.checkKey?.(apiKey);
      if (keyProblem) throw new AIError(keyProblem, "invalid_key");
      const account = { id, type: provider.type, name: provider.label, ...(apiKey ? { apiKey } : {}) };
      if (provider.custom) {
        account.name = clean(input.name, 60) || "Custom AI";
        account.baseUrl = checkBaseUrl(input.baseUrl);
      } else if (provider.local || provider.editableBaseUrl)
        account.baseUrl = checkBaseUrl(input.baseUrl || existing?.baseUrl || provider.defaultBaseUrl);
      // A key saved for one address never goes to another one.
      if ((provider.custom || provider.editableBaseUrl) && existing?.apiKey && existing.baseUrl !== account.baseUrl &&
        !(typeof input.apiKey === "string" && input.apiKey.trim()))
        throw new AIError("Paste the API key again when you change the address.", "missing_key");
      const next = accounts.filter((a) => a.id !== id).concat(account);
      await this.store.write({ version: 1, accounts: next });
      return Accounts.summary(account);
    });
  }
  async remove(id) {
    return this.exclusive(async () => {
      const accounts = await this.all();
      await this.store.write({ version: 1, accounts: accounts.filter((a) => a.id !== id) });
    });
  }
}
