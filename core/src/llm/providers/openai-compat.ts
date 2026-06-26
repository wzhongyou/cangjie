/**
 * OpenAI-compatible provider — 适配所有 OpenAI Chat Completions 兼容 API。
 *
 * 适用于: DeepSeek, Groq, Ollama, LM Studio, OpenRouter, 等。
 *
 * 与 openai.ts 实现几乎相同，但：
 * 1. baseUrl 为必填（无默认值，因为不是 openai.com）
 * 2. 移除了 stream_options（部分兼容 API 不支持）
 * 3. 更宽容的错误处理
 */
import type { LlmClient } from '../client.js';
import { createOpenAIClient } from './openai.js';

export interface OpenAICompatOptions {
  apiKey: string;
  model: string;
  baseUrl: string; // 必填
  maxTokens?: number;
}

export function createOpenAICompatClient(opts: OpenAICompatOptions): LlmClient {
  // 复用 OpenAI 客户端实现，只需调整 baseUrl
  // apiKey 对于某些本地模型可以是任意值（如 "ollama"）
  const client = createOpenAIClient({
    apiKey: opts.apiKey || 'not-needed',
    model: opts.model,
    baseUrl: opts.baseUrl.endsWith('/v1') ? opts.baseUrl : `${opts.baseUrl}/v1`,
    maxTokens: opts.maxTokens,
  });

  // 包装一层，针对兼容 API 做错误处理增强
  const originalChatStream = client.chatStream.bind(client);
  const originalChat = client.chat.bind(client);

  return {
    async chat(req) {
      try {
        return await originalChat(req);
      } catch (err: any) {
        // 尝试不传 tools 重试（某些兼容 API 不支持 tools）
        if (err.message?.includes('tool') || err.message?.includes('function')) {
          const fallbackReq = { ...req, tools: undefined };
          return await originalChat(fallbackReq);
        }
        throw err;
      }
    },

    async *chatStream(req) {
      for await (const event of originalChatStream(req)) {
        yield event;
      }
    },
  };
}
