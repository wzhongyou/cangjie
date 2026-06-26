/**
 * Model 容错层 — Retry + Fallback + Rate Limit + Usage 统计
 *
 * 包装 LlmClient，透明添加容错能力。
 */
import type { LlmRequest, LlmResponse, StreamEvent } from '@cangjie/shared';
import type { LlmClient, LlmClientOptions } from './client.js';
import { createLlmClient } from './client.js';
import { llmLog } from '../logger.js';

export interface ResilienceConfig {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 重试间隔基数 ms（指数退避，默认 1000） */
  retryBaseMs?: number;
  /** 备用模型（主模型不可用时自动切换） */
  fallbackModel?: string;
  /** 每分钟最大请求数（默认 0 = 不限） */
  rateLimitPerMinute?: number;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  retryCount: number;
  fallbackUsed: boolean;
  totalDurationMs: number;
}

export function createResilientClient(
  primaryOpts: LlmClientOptions,
  resilienceConfig: ResilienceConfig = {},
): { client: LlmClient; usage: SessionUsage } {
  const primary = createLlmClient(primaryOpts);
  const fallback = resilienceConfig.fallbackModel
    ? createLlmClient({ ...primaryOpts, model: resilienceConfig.fallbackModel })
    : null;

  const config = {
    maxRetries: resilienceConfig.maxRetries ?? 3,
    retryBaseMs: resilienceConfig.retryBaseMs ?? 1000,
    rateLimitPerMinute: resilienceConfig.rateLimitPerMinute ?? 0,
  };

  const usage: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    retryCount: 0,
    fallbackUsed: false,
    totalDurationMs: 0,
  };

  // Rate limiter: simple token bucket
  const requestTimes: number[] = [];

  function checkRateLimit(): boolean {
    if (config.rateLimitPerMinute <= 0) return true;
    const now = Date.now();
    const windowStart = now - 60_000;
    // Remove old entries
    while (requestTimes.length > 0 && requestTimes[0] < windowStart) {
      requestTimes.shift();
    }
    return requestTimes.length < config.rateLimitPerMinute;
  }

  async function executeWithRetry<T>(
    operation: (client: LlmClient) => Promise<T>,
    isStream: boolean,
  ): Promise<T> {
    let lastError: Error | null = null;
    const clients = [primary, fallback].filter(Boolean) as LlmClient[];

    for (const client of clients) {
      if (client !== primary) {
        usage.fallbackUsed = true;
        llmLog.warn({ fallbackModel: resilienceConfig.fallbackModel }, 'Switching to fallback model');
      }

      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        if (attempt > 0) {
          usage.retryCount++;
          const delay = config.retryBaseMs * Math.pow(2, attempt - 1);
          llmLog.warn({ attempt, delay }, 'Retrying after API error');
          await new Promise((r) => setTimeout(r, delay));
        }

        // Rate limit check
        if (!checkRateLimit()) {
          llmLog.warn('Rate limit reached, waiting...');
          await new Promise((r) => setTimeout(r, 5000));
        }

        try {
          const start = Date.now();
          const result = await operation(client);
          const duration = Date.now() - start;

          usage.requestCount++;
          usage.totalDurationMs += duration;

          // Track tokens (non-streaming only)
          if (!isStream && result && typeof result === 'object' && 'usage' in result) {
            const r = result as unknown as LlmResponse;
            usage.inputTokens += r.usage.input;
            usage.outputTokens += r.usage.output;
          }

          requestTimes.push(Date.now());

          return result;
        } catch (err: any) {
          lastError = err;

          // Don't retry on 4xx errors (except 429)
          const status = err.status ?? err.code;
          if (status && status >= 400 && status < 500 && status !== 429) {
            llmLog.error({ status, attempt }, 'Non-retryable API error');
            break;
          }

          if (attempt === config.maxRetries) {
            llmLog.error({ attempt: config.maxRetries }, 'Max retries exhausted');
          }
        }
      }
    }

    throw lastError ?? new Error('All models failed');
  }

  const resilientClient: LlmClient = {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      return executeWithRetry((client) => client.chat(req), false);
    },

    async *chatStream(req: LlmRequest): AsyncGenerator<StreamEvent> {
      // For streaming, we can't easily retry mid-stream.
      // We wrap the generator and track usage when done event arrives.
      let lastUsage = { input: 0, output: 0 };

      try {
        for await (const event of primary.chatStream(req)) {
          if (event.type === 'done') {
            lastUsage = event.usage;
            usage.inputTokens += event.usage.input;
            usage.outputTokens += event.usage.output;
          }
          yield event;
        }
        usage.requestCount++;
      } catch (err: any) {
        llmLog.error({ error: err.message }, 'Stream failed');
        throw err;
      }
    },
  };

  return { client: resilientClient, usage };
}
