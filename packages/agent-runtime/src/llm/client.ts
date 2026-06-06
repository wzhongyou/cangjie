import type { Message, LlmRequest, LlmResponse, ToolDefinition } from '@cangjie/shared';

export interface LlmClient {
  chat(req: LlmRequest): Promise<LlmResponse>;
}

export interface LlmClientOptions {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function createLlmClient(opts: LlmClientOptions): LlmClient {
  return createAnthropicClient(opts);
}

// ============================================================
// Anthropic Messages API
// ============================================================

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

function convertMessages(messages: Message[]): {
  systemPrompt: string;
  apiMessages: AnthropicMessage[];
} {
  const systemMsgs = messages.filter(m => m.role === 'system');
  const systemPrompt = systemMsgs.map(m => m.content).join('\n\n');
  const nonSystem = messages.filter(m => m.role !== 'system');

  const apiMessages: AnthropicMessage[] = [];
  let pendingToolResults: { toolCallId: string; content: string }[] = [];

  for (const msg of nonSystem) {
    if (msg.role === 'tool') {
      // 收集 tool results，它们将作为 user message 发送
      pendingToolResults.push({
        toolCallId: msg.toolCallId ?? '',
        content: msg.content,
      });
    } else if (msg.role === 'assistant') {
      // 如果有 pending tool results，先发送
      if (pendingToolResults.length > 0) {
        apiMessages.push({
          role: 'user',
          content: pendingToolResults.map(r => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
          })),
        });
        pendingToolResults = [];
      }

      // Assistant message: 如果有 tool calls, content 是 array
      if (msg.toolCalls?.length) {
        const blocks: AnthropicContentBlock[] = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        apiMessages.push({ role: 'assistant', content: blocks });
      } else {
        apiMessages.push({ role: 'assistant', content: msg.content });
      }
    } else {
      // user message
      apiMessages.push({ role: 'user', content: msg.content });
    }
  }

  return { systemPrompt, apiMessages };
}

function createAnthropicClient(opts: LlmClientOptions): LlmClient {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const baseUrl = opts.baseUrl || 'https://api.anthropic.com/v1';

  return {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

      const { systemPrompt, apiMessages } = convertMessages(req.messages);

      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: req.maxTokens ?? 8192,
        messages: apiMessages,
      };

      if (systemPrompt) body.system = systemPrompt;

      // Anthropic tool format
      if (req.tools?.length) {
        body.tools = req.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: 'object',
            properties: t.parameters?.properties ?? {},
            required: t.parameters?.required ?? [],
          },
        }));
      }

      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errText.slice(0, 500)}`);
      }

      const data = await response.json() as any;

      // 解析返回
      const blocks: AnthropicContentBlock[] = data.content ?? [];
      const textContent = blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      const toolCalls = blocks
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({
          id: b.id,
          name: b.name,
          arguments: b.input ?? {},
        }));

      return {
        message: {
          role: 'assistant',
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        usage: {
          input: data.usage?.input_tokens ?? 0,
          output: data.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
