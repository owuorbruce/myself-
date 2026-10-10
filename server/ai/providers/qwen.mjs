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

export default {
  type: "qwen",
  label: "Qwen",
  needsKey: true,
  editableBaseUrl: true,
  regions: REGIONS,
  defaultBaseUrl: REGIONS[0].baseUrl,
  keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
  preferredModel: /^qwen-plus(-latest)?$|^qwen\d+(\.\d+)?-plus$|^qwen-flash$/,
  async listModels(account, { signal }) {
    const models = await listOpenAIModels({ ...account, baseUrl: account.baseUrl || REGIONS[0].baseUrl }, {
      label: "Qwen", signal, filter: (m) => !NOT_CHAT.test(m.id),
    });
    return models.map((m) => ({ ...m, tools: m.tools ?? qwenTools(m.id) }));
  },
  stream(account, options) {
    return streamOpenAIChat({ ...account, baseUrl: account.baseUrl || REGIONS[0].baseUrl }, { ...options, label: "Qwen" });
  },
};
