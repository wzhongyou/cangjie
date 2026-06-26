/**
 * OpenAI Chat Completions API provider — streaming + non-streaming.
 *
 * 使用 SSE (Server-Sent Events) 协议解析流式响应。
 * 消息格式转换：System prompt 使用 "system" role（OpenAI 原生支持）。
 */
import type { LlmRequest, LlmResponse, Message, StreamEvent, ToolDefinition } from '@cangjie/shared';
import type { LlmClient } from '../client.js';

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

// ============================================================
// Message / Tool format conversion
// ============================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function convertMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((m) => {
    const base: OpenAIMessage = { role: m.role as OpenAIMessage['role'], content: m.content || null };

    if (m.role === 'assistant' && m.toolCalls?.length) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    if (m.role === 'tool') {
      base.tool_call_id = m.toolCallId;
    }

    return base;
  });
}

function convertTools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: (t.parameters?.properties ?? {}) as Record<string, unknown>,
        required: (t.parameters?.required ?? []) as string[],
        additionalProperties: false,
      },
    },
  }));
}

// ============================================================
// SSE Stream parsing
// ============================================================

interface OpenAIStreamChunk {
  id: string;
  object: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function* parseSSEStream(response: Response): AsyncGenerator<OpenAIStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data) as OpenAIStreamChunk;
        } catch {
          // skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============================================================
// Client
// ============================================================

export function createOpenAIClient(opts: OpenAIOptions): LlmClient {
  const baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
  const maxTokens = opts.maxTokens ?? 8192;

  return {
    /** Non-streaming chat */
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const body = {
        model: opts.model,
        messages: convertMessages(req.messages),
        max_tokens: req.maxTokens ?? maxTokens,
        tools: convertTools(req.tools),
        stream: false,
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const choice = data.choices?.[0];
      const msg = choice?.message ?? {};

      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function?.arguments ?? '{}');
          } catch {
            /* keep {} */
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function?.name ?? '',
            arguments: args,
          });
        }
      }

      return {
        message: {
          role: 'assistant',
          content: msg.content || '',
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
        },
      };
    },

    /** Streaming chat */
    async *chatStream(req: LlmRequest): AsyncGenerator<StreamEvent> {
      const body = {
        model: opts.model,
        messages: convertMessages(req.messages),
        max_tokens: req.maxTokens ?? maxTokens,
        tools: convertTools(req.tools),
        stream: true,
        stream_options: { include_usage: true },
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
      }

      // Track tool calls by index (OpenAI sends tool_calls as incremental delta array)
      const toolCallsByIndex = new Map<number, { id: string; name: string; argsJson: string }>();

      for await (const chunk of parseSSEStream(response)) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield { type: 'text_delta', text: delta.content };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;

            if (!toolCallsByIndex.has(idx)) {
              toolCallsByIndex.set(idx, { id: '', name: '', argsJson: '' });
            }

            const state = toolCallsByIndex.get(idx)!;
            if (tcDelta.id) state.id = tcDelta.id;
            if (tcDelta.function?.name) {
              state.name = tcDelta.function.name;
              yield { type: 'tool_use_start', id: state.id || `pending_${idx}`, name: state.name };
            }
            if (tcDelta.function?.arguments) {
              state.argsJson += tcDelta.function.arguments;
            }
          }
        }

        // Finish — flush tool calls
        if (choice.finish_reason) {
          for (const [idx, state] of toolCallsByIndex) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(state.argsJson);
            } catch {
              /* keep {} */
            }
            yield { type: 'tool_use_end', id: state.id || `pending_${idx}`, name: state.name, arguments: args };
          }
          toolCallsByIndex.clear();
        }

        // Usage (only in final chunk with stream_options.include_usage)
        if (chunk.usage) {
          yield {
            type: 'done',
            usage: {
              input: chunk.usage.prompt_tokens,
              output: chunk.usage.completion_tokens,
            },
          };
        }
      }
    },
  };
}
