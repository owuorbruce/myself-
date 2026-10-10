// Mistral (https://console.mistral.ai). The default for new conversations.
import { createHash } from "node:crypto";
import { listOpenAIModels, streamOpenAIChat } from "./openai-compatible.mjs";

const BASE = "https://api.mistral.ai/v1";
// Mistral only accepts 9-character letter-and-digit tool call ids.
const mistralId = (id) => /^[a-zA-Z0-9]{9}$/.test(id) ? id
  : createHash("sha256").update(String(id)).digest("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 9).padEnd(9, "0");

export default {
  type: "mistral",
  label: "Mistral",
  needsKey: true,
  keyUrl: "https://console.mistral.ai/api-keys",
  preferredModel: /mistral-medium-latest|mistral-small-latest|mistral-large-latest/,
  listModels(account, { signal }) {
    return listOpenAIModels({ ...account, baseUrl: BASE }, {
      label: "Mistral", signal,
      filter: (m) => m.capabilities?.completion_chat !== false && !m.deprecation,
    });
  },
  stream(account, options) {
    return streamOpenAIChat({ ...account, baseUrl: BASE }, { ...options, label: "Mistral", mapId: mistralId });
  },
};
