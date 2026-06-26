/**
 * 冒烟测试：Agent Loop 核心链路
 *
 * pnpm test（或 pnpm -C core test）
 */

import * as fs from 'node:fs';
import type { LlmRequest, LlmResponse, StreamEvent } from '@cangjie/shared';
import { describe, expect, it } from 'vitest';
import { CangjieAgent } from '../agent-loop.js';
import type { LlmClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';

// 确保测试工作区存在
const TEST_WORKSPACE = process.cwd();
if (!fs.existsSync('/tmp/test')) {
  fs.mkdirSync('/tmp/test', { recursive: true });
}

// 模拟 LLM 客户端（不实际调用 API）
function createMockLlm(): LlmClient {
  return {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      return {
        message: { role: 'assistant', content: 'ok' },
        usage: { input: 10, output: 5 },
      };
    },
    async *chatStream(req: LlmRequest): AsyncGenerator<StreamEvent> {
      const lastMsg = req.messages[req.messages.length - 1];
      const userContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';

      if (userContent.includes('test-grep')) {
        // 返回工具调用
        yield { type: 'text_delta', text: '我来搜索' };
        yield { type: 'tool_use_start', id: 'tc1', name: 'grep' };
        yield { type: 'tool_use_delta', id: 'tc1', arguments: '{"pattern":"login"' };
        yield { type: 'tool_use_delta', id: 'tc1', arguments: ',"path":"src"}' };
        yield {
          type: 'tool_use_end',
          id: 'tc1',
          name: 'grep',
          arguments: { pattern: 'login', path: 'src' },
        };
        yield { type: 'done', usage: { input: 100, output: 50 } };
        return;
      }

      if (lastMsg.role === 'tool') {
        // 工具结果返回后，模型给出最终回复
        yield { type: 'text_delta', text: '搜索完成，找到 3 个结果。' };
        yield { type: 'done', usage: { input: 200, output: 30 } };
        return;
      }

      // 默认：直接回复
      yield { type: 'text_delta', text: '收到你的消息。' };
      yield { type: 'done', usage: { input: 100, output: 20 } };
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

    expect(events.some((e) => e.type === 'response')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
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

    // grep tool is registered, should have tool_call and tool_result
    const toolCalls = events.filter((e) => e.type === 'tool_call');
    const toolResults = events.filter((e) => e.type === 'tool_result');
    const done = events.find((e) => e.type === 'done');

    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolResults.length).toBeGreaterThan(0);
    expect(done).toBeDefined();
  });

  it('AbortSignal 中断', async () => {
    let callCount = 0;
    const multiCallLlm: LlmClient = {
      async chat(_req: LlmRequest): Promise<LlmResponse> {
        return { message: { role: 'assistant', content: 'ok' }, usage: { input: 1, output: 1 } };
      },
      async *chatStream(_req: LlmRequest): AsyncGenerator<StreamEvent> {
        callCount++;
        if (callCount <= 1) {
          yield { type: 'tool_use_start', id: 't1', name: 'grep' };
          yield { type: 'tool_use_delta', id: 't1', arguments: '{}' };
          yield {
            type: 'tool_use_end',
            id: 't1',
            name: 'grep',
            arguments: { pattern: 'test' },
          };
          yield { type: 'done', usage: { input: 1, output: 1 } };
          return;
        }
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'done', usage: { input: 1, output: 1 } };
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
    for await (const event of agent.run({ prompt: 'hello' }, controller.signal)) {
      events.push(event);
      if (event.type === 'tool_call') {
        controller.abort();
      }
    }

    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('ToolRegistry', () => {
  it('内置工具已注册', () => {
    const tools = new ToolRegistry();
    const names = tools.list();
    // 原有工具
    expect(names).toContain('read_file');
    expect(names).toContain('grep');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('bash');
    // Phase 1 新增工具
    expect(names).toContain('glob');
    expect(names).toContain('todo_write');
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_search');
    expect(names).toContain('task');
    // 总共 10 个内置工具
    expect(names.length).toBe(10);
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
    const root = process.cwd();
    const result = await grepTool.execute(
      { pattern: 'cangjie', path: '.' },
      { workspaceRoot: root, sessionId: 't', signal: new AbortController().signal },
    );
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('glob 查找 TypeScript 文件', async () => {
    const { globTool } = await import('../tools/builtin/glob.js');
    const root = process.cwd();
    const result = await globTool.execute(
      { pattern: '**/*.ts', path: 'src' },
      { workspaceRoot: root, sessionId: 't', signal: new AbortController().signal },
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('.ts');
  });

  it('glob 列出目录', async () => {
    const { globTool } = await import('../tools/builtin/glob.js');
    const root = process.cwd();
    const result = await globTool.execute(
      { pattern: '.' },
      { workspaceRoot: root, sessionId: 't', signal: new AbortController().signal },
    );
    expect(result.error).toBeUndefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('todo_write 管理任务清单', async () => {
    const { todoWriteTool, getCurrentTodos } = await import('../tools/builtin/todo-write.js');
    const result = await todoWriteTool.execute(
      {
        todos: [
          { id: '1', content: '搜索相关代码', status: 'completed' },
          { id: '2', content: '修复 bug', status: 'in_progress' },
          { id: '3', content: '写测试', status: 'pending' },
        ],
      },
      { workspaceRoot: '/tmp', sessionId: 't', signal: new AbortController().signal },
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('任务清单已更新');
    expect(result.content).toContain('已完成');
    expect(getCurrentTodos()).toHaveLength(3);
  });

  it('todo_write 无效参数报错', async () => {
    const { todoWriteTool } = await import('../tools/builtin/todo-write.js');
    const result = await todoWriteTool.execute(
      { todos: [{ id: '1', content: 'test', status: 'invalid' }] },
      { workspaceRoot: '/tmp', sessionId: 't', signal: new AbortController().signal },
    );
    expect(result.error).toBe('invalid_args');
  });
});

describe('TaskState', () => {
  it('状态机流转', async () => {
    const { TaskState } = await import('../task-state.js');
    const ts = new TaskState();
    expect(ts.phase).toBe('planning');
    
    ts.updateTodos([{ id: '1', content: 'a', status: 'in_progress' }]);
    expect(ts.phase).toBe('executing');
    
    ts.updateTodos([{ id: '1', content: 'a', status: 'completed' }]);
    expect(ts.phase).toBe('done');
    
    expect(ts.summary().total).toBe(1);
    expect(ts.summary().completed).toBe(1);
  });

  it('StepRecord 追踪', async () => {
    const { TaskState } = await import('../task-state.js');
    const ts = new TaskState();
    ts.recordStep({ step: 0, type: 'tool_call', detail: 'grep pattern=test', toolName: 'grep' });
    expect(ts.executionTrace).toHaveLength(1);
    expect(ts.executionTrace[0].toolName).toBe('grep');
  });
});

describe('Sandbox', () => {
  it('阻止命令注入', async () => {
    const { checkBashCommand } = await import('../sandbox.js');
    expect(checkBashCommand('echo $(whoami)').allowed).toBe(false);
    expect(checkBashCommand('echo `whoami`').allowed).toBe(false);
    expect(checkBashCommand('eval "echo hi"').allowed).toBe(false);
  });

  it('允许安全命令', async () => {
    const { checkBashCommand } = await import('../sandbox.js');
    expect(checkBashCommand('npm test').allowed).toBe(true);
    expect(checkBashCommand('ls -la').allowed).toBe(true);
    expect(checkBashCommand('git status').allowed).toBe(true);
  });

  it('高危命令警告', async () => {
    const { checkBashCommand } = await import('../sandbox.js');
    const r = checkBashCommand('rm -rf /tmp/test');
    expect(r.allowed).toBe(true);
    // No / root match for /tmp/test
  });
});

describe('MemoryManager', () => {
  it('读取项目记忆', async () => {
    const { loadProjectMemories } = await import('../memory-manager.js');
    const memories = loadProjectMemories(process.cwd());
    expect(Array.isArray(memories)).toBe(true);
  });

  it('读取用户记忆', async () => {
    const { loadUserMemories } = await import('../memory-manager.js');
    const memories = loadUserMemories();
    expect(Array.isArray(memories)).toBe(true);
  });
});
