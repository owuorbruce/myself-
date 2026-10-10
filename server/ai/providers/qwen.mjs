// Qwen through Alibaba Cloud Model Studio's OpenAI-compatible API.
// The default for new conversations. API keys only work with their own
// region's address, so the region (or a workspace address) is chosen in Settings.
// Addresses from https://www.alibabacloud.com/help/en/model-studio/base-url
import { listOpenAIModels, streamOpenAIChat } from "./openai-compatible.mjs";

export const REGIONS = [
  { id: "intl", name: "International (Singapore)", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { id: "us", name: "US (Virginia)", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" },
  { id: "cn", name: "China (Beijing)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "hk", name: "China (Hong Kong)", baseUrl: "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1" },
];

// Model families Alibaba documents as supporting function calling
// (https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling).
const TOOLS = /^qwen(\d+(\.\d+)?)?-(max|plus|flash|turbo|coder)|^qwen\d+(\.\d+)?-(vl-(plus|flash)|omni)|^qwen-(vl-(max|plus)|omni)|^qwen(2\.5|\d+(\.\d+)?)-[\d.]+b|^qwen\d+(\.\d+)?-coder/i;
const NO_TOOLS = /qwen-mt|deep-research|qvq|-math/i;
const NOT_CHAT = /asr|tts|realtime|livetranslate|wan|image|embedding|rerank|ocr|gui|audio|s2s|translate/i;

export function qwenTools(id) {
  if (NO_TOOLS.test(id)) return false;
  return TOOLS.test(id) ? true : null;
}

const baseOf = (account) => account.baseUrl || REGIONS[0].baseUrl;
const regionName = (baseUrl) =>
  REGIONS.find((r) => r.baseUrl === baseUrl)?.name || (/maas\.aliyuncs\.com/.test(baseUrl) ? "your workspace address" : baseUrl);

/** Turn a rejected key into advice that fits Model Studio's usual causes. */
function explainKey(account, error) {
  if (error?.code !== "unauthorized") return error;
  const key = account.apiKey || "";
  if (/^LTAI/.test(key))
    error.message = "That's an Alibaba Cloud AccessKey, not a Model Studio API key. Create an API key in Model Studio (it starts with sk-) and paste it in Settings & backups → AI providers.";
  else
    error.message = error.message.replace(/ Check it in Settings[^]*$/, "") +
      ` Slate sent it to ${regionName(baseOf(account))}. Model Studio keys only work in the region they were created in, so pick that region (or paste the key again after switching) in Settings & backups → AI providers.`;
  return error;
}

export default {
  type: "qwen",
  label: "Qwen",
  needsKey: true,
  editableBaseUrl: true,
  regions: REGIONS,
  defaultBaseUrl: REGIONS[0].baseUrl,
  keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
  checkKey(key) {
    if (/^LTAI/.test(key)) return "That's an Alibaba Cloud AccessKey ID, not a Model Studio API key. Create an API key in Model Studio (it starts with sk-).";
    return "";
  },
  preferredModel: /^qwen-plus(-latest)?$|^qwen\d+(\.\d+)?-plus$|^qwen-flash$/,
  async listModels(account, { signal }) {
    const models = await listOpenAIModels({ ...account, baseUrl: baseOf(account) }, {
      label: "Qwen", signal, filter: (m) => !NOT_CHAT.test(m.id),
    }).catch((e) => { throw explainKey(account, e); });
    return models.map((m) => ({ ...m, tools: m.tools ?? qwenTools(m.id) }));
  },
  stream(account, options) {
    return streamOpenAIChat({ ...account, baseUrl: baseOf(account) }, { ...options, label: "Qwen" })
      .catch((e) => { throw explainKey(account, e); });
  },
};
