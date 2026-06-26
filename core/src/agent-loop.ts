/**
 * Cangjie Agent Loop — 模仿 Claude Code 的单线程主循环
 *
 * 核心理念（来自 Claude Code 的教训）：
 * 1. Keep it simple — 一个 while 循环，不过度抽象
 * 2. 工具是 plain text in/out — 模型自己理解
 * 3. 上下文压缩是第一工程挑战
 * 4. 用户可以在任何时候发信号中断
 */

import type { AgentEvent, CangjieConfig, Message, StreamEvent, Tool } from '@cangjie/shared';
import { ContextManager } from './context/manager.js';
import type { LlmClient } from './llm/client.js';
import { agentLog, llmLog, permLog, toolLog } from './logger.js';
import { PermissionPipeline } from './permission/pipeline.js';
import type { ToolRegistry } from './tools/registry.js';

export interface AgentConfig {
  config: CangjieConfig;
  workspaceRoot: string;
  sessionId: string;
  maxSteps?: number;
}

export interface AgentInput {
  prompt: string;
  systemPrompt?: string;
  /** 携带历史消息（多轮对话） */
  history?: Message[];
}

export interface RunResult {
  steps: number;
  messages: Message[];
}

export class CangjieAgent {
  private contextManager: ContextManager;
  private permission: PermissionPipeline;
  /** 最近一次 run 完成后的完整消息历史 */
  public lastMessages: Message[] = [];

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
   * v0.1 改进：
   * - LLM 流式输出 token 级别（Agent 能推送 thinking 增量）
   * - 工具并发执行（Promise.all）
   * - AbortSignal 支持优雅中断
   */
  async *run(input: AgentInput, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const maxSteps = this.cfg.maxSteps ?? 100;

    const messages: Message[] = [];

    // 系统 prompt + 历史 + 当前 prompt
    messages.push({ role: 'system', content: input.systemPrompt ?? this.defaultSystemPrompt() });
    if (input.history?.length) {
      messages.push(...input.history);
    }
    messages.push({ role: 'user', content: input.prompt });

    agentLog.info({ sessionId: this.cfg.sessionId }, 'Agent run started');

    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) {
        yield { type: 'error', error: 'Aborted by user' };
        break;
      }

      // 上下文压缩检查
      const beforeCompact = messages.length;
      messages.length = this.contextManager.maybeCompact(messages);
      if (messages.length < beforeCompact) {
        agentLog.warn({ step, before: beforeCompact, after: messages.length }, 'Context compacted');
      }

      // === LLM 流式调用 ===
      const llmStart = Date.now();
      let textContent = '';
      const pendingToolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }> = [];
      const toolUseState = new Map<string, { name: string; argsJson: string }>();

      try {
        for await (const se of this.llm.chatStream({
          messages,
          tools: this.tools.definitions(),
          maxTokens: this.cfg.config.llm.maxTokens,
        })) {
          if (signal?.aborted) break;

          switch (se.type) {
            case 'text_delta':
              textContent += se.text;
              yield { type: 'thinking', content: se.text };
              break;

            case 'tool_use_start':
              toolUseState.set(se.id, { name: se.name, argsJson: '' });
              break;

            case 'tool_use_delta':
              if (toolUseState.has(se.id)) {
                toolUseState.get(se.id)!.argsJson += se.arguments;
              }
              break;

            case 'tool_use_end':
              pendingToolCalls.push({
                id: se.id,
                name: se.name,
                arguments: se.arguments,
              });
              yield { type: 'tool_call', tool: se.name, args: se.arguments };
              break;

            case 'done':
              // Stream complete — no explicit action, handled below
              break;
          }
        }
      } catch (err: any) {
        llmLog.error({ step, duration: Date.now() - llmStart, error: err.message }, 'LLM call failed');
        yield { type: 'error', error: `LLM 调用失败: ${err.message}` };
        break;
      }

      llmLog.debug({ step, duration: Date.now() - llmStart, toolCalls: pendingToolCalls.length }, 'LLM call done');

      // Build assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: textContent,
        toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
      };
      messages.push(assistantMsg);

      // 检查中断信号（可能在流式过程中被触发）
      if (signal?.aborted) {
        yield { type: 'error', error: 'Aborted by user' };
        break;
      }

      // 无工具调用 = 任务完成
      if (!pendingToolCalls.length) {
        yield { type: 'response', content: textContent };
        yield { type: 'done', steps: step + 1 };
        agentLog.info({ steps: step + 1 }, 'Agent run completed');
        break;
      }

      // === 并发执行工具（先执行完，再批量 yield） ===
      const toolExecutionResults = await Promise.all(
        pendingToolCalls.map(async (tc) => {
          // 权限检查
          const decision = await this.permission.check(tc.name, tc.arguments);
          if (decision.action !== 'allow') {
            permLog.warn({ tool: tc.name, action: decision.action, reason: decision.reason }, 'Permission denied');
            return {
              toolCallId: tc.id,
              toolName: tc.name,
              content: `Permission ${decision.action}: ${decision.reason ?? ''}`,
              duration: 0,
              isError: true,
            };
          }

          // 执行工具
          const tool = this.tools.get(tc.name);
          const start = Date.now();
          toolLog.debug({ tool: tc.name, args: JSON.stringify(tc.arguments).slice(0, 200) }, 'Tool executing');
          const result = tool
            ? await tool.execute(tc.arguments, {
                workspaceRoot: this.cfg.workspaceRoot,
                sessionId: this.cfg.sessionId,
                signal: signal ?? new AbortController().signal,
              })
            : { content: `Tool not found: ${tc.name}`, error: 'not_found' };

          const duration = Date.now() - start;
          if (result.error) {
            toolLog.warn({ tool: tc.name, duration, error: result.error }, 'Tool failed');
          } else {
            toolLog.debug({ tool: tc.name, duration }, 'Tool done');
          }

          return {
            toolCallId: tc.id,
            toolName: tc.name,
            content: result.error ? `Error: ${result.content}` : result.content,
            duration,
            isError: !!result.error,
          };
        }),
      );

      // Yield tool results and push to messages
      for (const tr of toolExecutionResults) {
        yield {
          type: 'tool_result',
          tool: tr.toolName,
          result: tr.content,
          duration: tr.duration,
        };
        messages.push({
          role: 'tool',
          content: tr.content,
          toolCallId: tr.toolCallId,
        });
      }

      // 保存消息历史供多轮对话
      this.lastMessages = messages;
    }
  }

  private defaultSystemPrompt(): string {
    return [
      'You are Cangjie, an autonomous code agent.',
      '',
      'Your tools:',
      '- read_file: Read a file (with optional offset/limit)',
      '- grep: Search codebase with regex patterns',
      '- write_file: Create or overwrite a file',
      '- edit_file: Diff-based editing — find old_string, replace with new_string',
      '- bash: Execute shell commands',
      '',
      'Guidelines:',
      '- Before editing, read the target file first to understand its content.',
      '- Prefer edit_file for small changes; use write_file only for new files or full rewrites.',
      '- After making changes, verify them by reading the file back or running tests.',
      "- Keep responses in the user's language.",
      '- Check .cangjie/memory/ for project-specific instructions and conventions.',
    ].join('\n');
  }
}
