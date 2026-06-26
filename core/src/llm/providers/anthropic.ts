/**
 * Anthropic Messages API provider — streaming + non-streaming.
 *
 * Uses @anthropic-ai/sdk for native streaming support.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmRequest, LlmResponse, Message, StreamEvent, ToolDefinition } from '@cangjie/shared';
import type { LlmClient } from '../client.js';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

// ============================================================
// Tool / Message format conversion
// ============================================================

function convertTools(tools?: ToolDefinition[]): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: (t.parameters?.properties ?? {}) as Record<string, unknown>,
      required: (t.parameters?.required ?? []) as string[],
    },
  }));
}

function convertMessages(messages: Message[]): {
  systemPrompt: string;
  apiMessages: Anthropic.MessageParam[];
} {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const systemPrompt = systemMsgs.map((m) => m.content).join('\n\n');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  const apiMessages: Anthropic.MessageParam[] = [];
  const toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const msg of nonSystem) {
    if (msg.role === 'tool') {
      toolResults.push({
        type: 'tool_result' as const,
        tool_use_id: msg.toolCallId ?? '',
        content: msg.content,
      });
    } else if (msg.role === 'assistant') {
      if (toolResults.length > 0) {
        apiMessages.push({ role: 'user', content: toolResults.splice(0) });
      }
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments as Record<string, unknown>,
          });
        }
      }
      apiMessages.push({ role: 'assistant', content: blocks });
    } else {
      if (toolResults.length > 0) {
        apiMessages.push({ role: 'user', content: toolResults.splice(0) });
      }
      apiMessages.push({ role: 'user', content: msg.content });
    }
  }

  if (toolResults.length > 0) {
    apiMessages.push({ role: 'user', content: toolResults });
  }

  return { systemPrompt, apiMessages };
}

// ============================================================
// Client
// ============================================================

export function createAnthropicClient(opts: AnthropicOptions): LlmClient {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl || undefined });
  const maxTokens = opts.maxTokens ?? 8192;

  return {
    /** Non-streaming chat */
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const { systemPrompt, apiMessages } = convertMessages(req.messages);
      const body: Anthropic.MessageCreateParams = {
        model: opts.model,
        max_tokens: req.maxTokens ?? maxTokens,
        messages: apiMessages,
      };
      if (systemPrompt) body.system = systemPrompt;

      const tools = convertTools(req.tools);
      if (tools) body.tools = tools;

      const response = await client.messages.create(body);

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
      const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      return {
        message: {
          role: 'assistant',
          content: textBlocks.map((b) => b.text).join('\n'),
          toolCalls:
            toolBlocks.length > 0
              ? toolBlocks.map((b) => ({
                  id: b.id,
                  name: b.name,
                  arguments: b.input as Record<string, unknown>,
                }))
              : undefined,
        },
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      };
    },

    /** Streaming chat */
    async *chatStream(req: LlmRequest): AsyncGenerator<StreamEvent> {
      const { systemPrompt, apiMessages } = convertMessages(req.messages);
      const body: Anthropic.MessageCreateParams = {
        model: opts.model,
        max_tokens: req.maxTokens ?? maxTokens,
        messages: apiMessages,
      };
      if (systemPrompt) body.system = systemPrompt;

      const tools = convertTools(req.tools);
      if (tools) body.tools = tools;
      body.stream = true as any;

      const stream = client.messages.stream(body as any);

      const toolUseByIndex = new Map<number, { id: string; name: string; argsJson: string }>();

      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_delta': {
            const idx = (event as any).index;
            const delta = event.delta as any;
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              const state = toolUseByIndex.get(idx);
              if (state) state.argsJson += delta.partial_json;
            }
            break;
          }
          case 'content_block_start': {
            const idx = (event as any).index;
            const block = event.content_block as any;
            if (block.type === 'tool_use') {
              toolUseByIndex.set(idx, { id: block.id, name: block.name, argsJson: '' });
              yield { type: 'tool_use_start', id: block.id, name: block.name };
            }
            break;
          }
          case 'content_block_stop': {
            const idx = (event as any).index;
            const state = toolUseByIndex.get(idx);
            if (state) {
              toolUseByIndex.delete(idx);
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(state.argsJson);
              } catch {
                /* keep {} */
              }
              yield { type: 'tool_use_end', id: state.id, name: state.name, arguments: args };
            }
            break;
          }
          case 'message_delta': {
            for (const [, state] of toolUseByIndex) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(state.argsJson);
              } catch {
                /* keep {} */
              }
              yield { type: 'tool_use_end', id: state.id, name: state.name, arguments: args };
            }
            toolUseByIndex.clear();
            yield {
              type: 'done',
              usage: {
                input: (event.usage as any)?.input_tokens ?? 0,
                output: event.usage?.output_tokens ?? 0,
              },
            };
            break;
          }
        }
      }
    },
  };
}
