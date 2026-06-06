/**
 * LLM 客户端抽象 — 统一 Anthropic/OpenAI/Gemini 接口
 *
 * 设计原则：
 * - 底层用各家的 SDK，上层统一接口
 * - 流式响应暂时不在此层做（留给上层 Adaptor）
 */

import type { Message, LlmRequest, LlmResponse, ToolDefinition } from '@cangjie/shared';

export interface LlmClient {
  chat(req: LlmRequest): Promise<LlmResponse>;
}

export interface LlmClientOptions {
  provider: 'anthropic' | 'openai' | 'gemini' | 'local';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function createLlmClient(opts: LlmClientOptions): LlmClient {
  switch (opts.provider) {
    default:
      // MVP 阶段先用 Anthropic
      return createAnthropicClient(opts);
  }
}

// ============================================================
// Anthropic 适配器
// ============================================================

function createAnthropicClient(opts: LlmClientOptions): LlmClient {
  return {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required');
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: req.maxTokens ?? 8192,
          system: req.messages.find(m => m.role === 'system')?.content,
          messages: req.messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'tool' ? 'user' : m.role,
            content: m.role === 'tool'
              ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
              : m.content,
          })),
          tools: req.tools?.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
      });

      const data = await response.json() as any;

      // 标准化响应
      const toolCalls = data.content
        ?.filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ id: b.id, name: b.name, arguments: b.input })) ?? [];

      const textContent = data.content
        ?.filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n') ?? '';

      return {
        message: { role: 'assistant', content: textContent, toolCalls },
        usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
      };
    },
  };
}
