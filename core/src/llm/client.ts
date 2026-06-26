/**
 * LLM 客户端 — 统一接口 + Provider 工厂
 *
 * 支持的 Provider:
 *   - anthropic     → Anthropic Messages API (native)
 *   - openai        → OpenAI Chat Completions API
 *   - openai-compat → OpenAI-compatible (DeepSeek, Groq, Ollama, ...)
 */
import type { LlmProvider, LlmRequest, LlmResponse, StreamEvent } from '@cangjie/shared';
import { createAnthropicClient } from './providers/anthropic.js';
import { createOpenAIClient } from './providers/openai.js';
import { createOpenAICompatClient } from './providers/openai-compat.js';

export interface LlmClient {
  chat(req: LlmRequest): Promise<LlmResponse>;
  chatStream(req: LlmRequest): AsyncGenerator<StreamEvent>;
}

export interface LlmClientOptions {
  provider: LlmProvider | string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

/**
 * 工厂函数：根据 provider 类型创建对应的 LLM 客户端。
 *
 * 用法：
 *   const llm = createLlmClient({ provider: 'anthropic', apiKey: '...', model: '...' });
 *   const llm = createLlmClient({ provider: 'openai', apiKey: '...', model: '...' });
 *   const llm = createLlmClient({ provider: 'openai-compat', apiKey: '...', model: '...', baseUrl: '...' });
 */
export function createLlmClient(opts: LlmClientOptions): LlmClient {
  switch (opts.provider) {
    case 'anthropic':
      return createAnthropicClient({
        apiKey: opts.apiKey,
        model: opts.model,
        baseUrl: opts.baseUrl,
        maxTokens: opts.maxTokens,
      });

    case 'openai':
      return createOpenAIClient({
        apiKey: opts.apiKey,
        model: opts.model,
        baseUrl: opts.baseUrl,
        maxTokens: opts.maxTokens,
      });

    case 'openai-compat':
      if (!opts.baseUrl) {
        throw new Error('openai-compat provider requires baseUrl');
      }
      return createOpenAICompatClient({
        apiKey: opts.apiKey,
        model: opts.model,
        baseUrl: opts.baseUrl,
        maxTokens: opts.maxTokens,
      });

    default:
      throw new Error(`Unknown provider: ${opts.provider}. Supported providers: anthropic, openai, openai-compat`);
  }
}
