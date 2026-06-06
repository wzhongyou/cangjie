/**
 * Cangjie Agent Loop — 模仿 Claude Code 的单线程主循环
 *
 * 核心理念（来自 Claude Code 的教训）：
 * 1. Keep it simple — 一个 while 循环，不过度抽象
 * 2. 工具是 plain text in/out — 模型自己理解
 * 3. 上下文压缩是第一工程挑战
 * 4. 用户可以在任何时候发信号中断
 */

import type { Message, AgentEvent, Tool, CangjieConfig } from '@cangjie/shared';
import type { LlmClient } from './llm/client.js';
import { ContextManager } from './context/manager.js';
import { ToolRegistry } from './tools/registry.js';
import { PermissionPipeline } from './permission/pipeline.js';

export interface AgentConfig {
  config: CangjieConfig;
  workspaceRoot: string;
  sessionId: string;
  maxSteps?: number;
}

export interface AgentInput {
  prompt: string;
  systemPrompt?: string;
}

export interface RunResult {
  steps: number;
  messages: Message[];
}

export class CangjieAgent {
  private contextManager: ContextManager;
  private permission: PermissionPipeline;

  constructor(
    private llm: LlmClient,
    private tools: ToolRegistry,
    private cfg: AgentConfig,
  ) {
    this.contextManager = new ContextManager(cfg.config.context);
    this.permission = new PermissionPipeline(cfg.config.permissions);
  }

  /**
   * 流式执行 Agent
   *
   * 设计要点：
   * - AsyncGenerator 实现控制反转（Agent 推送事件，调用者拉取）
   * - AbortSignal 支持优雅中断
   * - 不再依赖 VSCode API，纯 Node.js 可跑
   */
  async *run(input: AgentInput, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const maxSteps = this.cfg.maxSteps ?? 100;

    const messages: Message[] = [
      { role: 'system', content: input.systemPrompt ?? this.defaultSystemPrompt() },
      { role: 'user', content: input.prompt },
    ];

    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) {
        yield { type: 'error', error: 'Aborted by user' };
        break;
      }

      // 上下文压缩检查
      messages.length = this.contextManager.maybeCompact(messages);

      // LLM 调用
      const response = await this.llm.chat({
        messages,
        tools: this.tools.definitions(),
        maxTokens: this.cfg.config.llm.maxTokens,
      });

      const assistantMsg: Message = { role: 'assistant', content: response.message.content, toolCalls: response.message.toolCalls };
      messages.push(assistantMsg);

      // 无工具调用 = 任务完成
      if (!response.message.toolCalls?.length) {
        yield { type: 'response', content: response.message.content };
        yield { type: 'done', steps: step + 1 };
        break;
      }

      // 执行工具调用（并发）
      for (const tc of response.message.toolCalls) {
        yield { type: 'tool_call', tool: tc.name, args: tc.arguments };

        // 权限检查
        const decision = await this.permission.check(tc.name, tc.arguments);
        if (decision.action !== 'allow') {
          messages.push({ role: 'tool', content: `Permission ${decision.action}: ${decision.reason ?? ''}`, toolCallId: tc.id });
          continue;
        }

        // 执行工具
        const tool = this.tools.get(tc.name);
        const start = Date.now();
        const result = tool
          ? await tool.execute(tc.arguments, {
              workspaceRoot: this.cfg.workspaceRoot,
              sessionId: this.cfg.sessionId,
              signal: signal ?? new AbortController().signal,
            })
          : { content: `Tool not found: ${tc.name}`, error: 'not_found' };

        yield { type: 'tool_result', tool: tc.name, result: result.content, duration: Date.now() - start };
        messages.push({ role: 'tool', content: result.error ? `Error: ${result.content}` : result.content, toolCallId: tc.id });
      }
    }
  }

  private defaultSystemPrompt(): string {
    return [
      'You are Cangjie, an autonomous code agent running inside VSCode.',
      '',
      'Your capabilities:',
      '- Read, write, and edit files in the workspace',
      '- Search code with grep, glob, and semantic search',
      '- Execute shell commands (subject to user permission)',
      '- Navigate code with LSP (go to definition, find references)',
      '- Browse the web for documentation',
      '',
      'Always plan before acting. Use the todo_write tool to track progress.',
      'When editing code, use edit_file (diff-based) rather than write_file (full rewrite).',
      'After making changes, verify them — run tests, check for lint errors.',
    ].join('\n');
  }
}
