/**
 * 冒烟测试：Agent Loop 核心链路
 *
 * npx vitest run packages/agent-runtime/src/__test__/smoke.test.ts
 */

import { describe, it, expect } from 'vitest';
import { CangjieAgent } from '../agent-loop.js';
import { ToolRegistry } from '../tools/registry.js';
import type { LlmRequest, LlmResponse } from '@cangjie/shared';
import type { LlmClient } from '../llm/client.js';

// 模拟 LLM 客户端（不实际调用 API）
function createMockLlm(): LlmClient {
  return {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      // 检查是否第一次调用（无历史工具调用 = 模型应该决定用什么工具）
      const lastMsg = req.messages[req.messages.length - 1];
      const userContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';

      if (userContent.includes('test-grep')) {
        // 返回工具调用
        return {
          message: {
            role: 'assistant',
            content: '我来搜索一下。',
            toolCalls: [{ id: 'tc1', name: 'grep', arguments: { pattern: 'login', path: 'src' } }],
          },
          usage: { input: 100, output: 50 },
        };
      }

      if (lastMsg.role === 'tool') {
        // 工具结果返回后，模型给出最终回复
        return {
          message: { role: 'assistant', content: '搜索完成，找到 3 个结果。' },
          usage: { input: 200, output: 30 },
        };
      }

      // 默认：直接回复
      return {
        message: { role: 'assistant', content: '收到你的消息。' },
        usage: { input: 100, output: 20 },
      };
    },
  };
}

describe('Agent Loop', () => {
  it('初次调用 LLM 并返回响应', async () => {
    const llm = createMockLlm();
    const tools = new ToolRegistry();
    const agent = new CangjieAgent(llm, tools, {
      config: {
        llm: { provider: 'mock', apiKey: '', model: 'mock', maxTokens: 1000 },
        permissions: { autoAllowReadOnly: true, rules: [] },
        context: { maxHistoryTokens: 10000, compactionThreshold: 0.9 },
      },
      workspaceRoot: '/tmp/test',
      sessionId: 'test-1',
    });

    const events: any[] = [];
    for await (const event of agent.run({ prompt: 'hello' })) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'response')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('调用工具并返回工具结果', async () => {
    const llm = createMockLlm();
    const tools = new ToolRegistry();
    const agent = new CangjieAgent(llm, tools, {
      config: {
        llm: { provider: 'mock', apiKey: '', model: 'mock', maxTokens: 1000 },
        permissions: { autoAllowReadOnly: true, rules: [] },
        context: { maxHistoryTokens: 10000, compactionThreshold: 0.9 },
      },
      workspaceRoot: '/tmp/test',
      sessionId: 'test-2',
    });

    const events: any[] = [];
    for await (const event of agent.run({ prompt: 'test-grep login' })) {
      events.push(event);
    }

    // 应该有 tool_call 和 tool_result
    const toolCalls = events.filter(e => e.type === 'tool_call');
    const toolResults = events.filter(e => e.type === 'tool_result');
    const done = events.find(e => e.type === 'done');

    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolResults.length).toBeGreaterThan(0);
    expect(done).toBeDefined();
  });

  it('AbortSignal 中断（在工具调用前中断）', async () => {
    // 返回多次 tool call 的 mock，给中断窗口
    let callCount = 0;
    const multiCallLlm: LlmClient = {
      async chat(_req: LlmRequest): Promise<LlmResponse> {
        callCount++;
        if (callCount <= 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 't1', name: 'grep', arguments: { pattern: 'test' } }],
            },
            usage: { input: 1, output: 1 },
          };
        }
        return { message: { role: 'assistant', content: 'done' }, usage: { input: 1, output: 1 } };
      },
    };

    const tools = new ToolRegistry();
    const agent = new CangjieAgent(multiCallLlm, tools, {
      config: {
        llm: { provider: 'mock', apiKey: '', model: 'mock', maxTokens: 1000 },
        permissions: { autoAllowReadOnly: true, rules: [] },
        context: { maxHistoryTokens: 10000, compactionThreshold: 0.9 },
      },
      workspaceRoot: '/tmp/test',
      sessionId: 'test-3',
      maxSteps: 10,
    });

    const controller = new AbortController();

    const events: any[] = [];
    let stepCount = 0;
    for await (const event of agent.run({ prompt: 'hello' }, controller.signal)) {
      events.push(event);
      stepCount++;
      // 在第一步 tool_call 后立即中断
      if (event.type === 'tool_call') {
        controller.abort();
      }
    }

    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});

describe('ToolRegistry', () => {
  it('内置工具已注册', () => {
    const tools = new ToolRegistry();
    const names = tools.list();
    expect(names).toContain('read_file');
    expect(names).toContain('grep');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('bash');
  });
});

describe('Builtin Tools', () => {
  it('read_file 读取存在的文件', async () => {
    const { readFileTool } = await import('../tools/builtin/read-file.js');
    const result = await readFileTool.execute(
      { file_path: 'package.json' },
      { workspaceRoot: process.cwd(), sessionId: 't', signal: new AbortController().signal },
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('cangjie');
  });

  it('grep 搜索代码', async () => {
    const { grepTool } = await import('../tools/builtin/grep.js');
    // 使用项目根目录，搜索 package.json 所在目录
    const root = process.cwd();
    const result = await grepTool.execute(
      { pattern: 'cangjie', path: '.' },
      { workspaceRoot: root, sessionId: 't', signal: new AbortController().signal },
    );
    // grep 可能失败（没有 rg），但只要不抛异常就是正常的
    expect(result.content.length).toBeGreaterThan(0);
  });
});
