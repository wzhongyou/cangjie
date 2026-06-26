/**
 * useAgentStream — 管理 Agent AsyncGenerator 事件流
 *
 * 将 CangjieAgent.run() 的异步事件流接入 React 组件树：
 *  - 流式 thinking 文字逐字显示
 *  - 工具调用/结果显示
 *  - 任务计划更新
 *  - 自动停止
 */
import type { AgentEvent, Message } from '@cangjie/shared';
import { useCallback, useRef, useState } from 'react';

export interface StreamState {
  /** 是否正在流式输出中 */
  streaming: boolean;
  /** 当前 thinking 缓冲文字 */
  thinkingText: string;
  /** 对话消息列表（用户 + 助手 + 工具结果） */
  messages: ChatMessage[];
  /** 当前任务计划 */
  todos: TodoItem[];
  /** 执行步数 */
  step: number;
  /** 错误信息 */
  error: string | null;
  /** 是否完成 */
  done: boolean;
  /** Token 用量 */
  usage: { input: number; output: number };
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolDuration?: number;
}

export function useAgentStream() {
  const [state, setState] = useState<StreamState>({
    streaming: false,
    thinkingText: '',
    messages: [],
    todos: [],
    step: 0,
    error: null,
    done: false,
    usage: { input: 0, output: 0 },
  });

  const abortRef = useRef<AbortController | null>(null);
  const _messagesRef = useRef<Message[]>([]);

  /** 开始执行 Agent */
  const run = useCallback(async (agentRun: AsyncGenerator<AgentEvent>, userPrompt: string) => {
    // Reset state
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userPrompt,
    };

    setState((prev) => ({
      ...prev,
      streaming: true,
      thinkingText: '',
      messages: [...prev.messages, userMsg],
      error: null,
      done: false,
      step: 0,
    }));

    // Collect events in a buffer, flush to React at ~30fps
    let thinkingBuf = '';
    const newMessages: ChatMessage[] = [];
    let todos: TodoItem[] = [];
    let step = 0;
    let error: string | null = null;
    const usage = { input: 0, output: 0 };
    let done = false;
    let lastFlush = Date.now();
    let pendingFlush: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (pendingFlush) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      setState((prev) => ({
        ...prev,
        thinkingText: thinkingBuf,
        messages: [...prev.messages, ...newMessages.splice(0)],
        todos: todos.length > 0 ? todos : prev.todos,
        step,
        error,
        done,
        usage,
      }));
    };

    const scheduleFlush = () => {
      const now = Date.now();
      if (now - lastFlush > 33) {
        // ~30fps
        flush();
        lastFlush = now;
      } else if (!pendingFlush) {
        pendingFlush = setTimeout(flush, 33 - (now - lastFlush));
      }
    };

    try {
      for await (const event of agentRun) {
        switch (event.type) {
          case 'thinking':
            thinkingBuf += event.content;
            scheduleFlush();
            break;

          case 'tool_call': {
            const msg: ChatMessage = {
              id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'tool',
              content: '',
              toolName: event.tool,
              toolArgs: event.args,
            };
            newMessages.push(msg);
            scheduleFlush();
            break;
          }

          case 'tool_result': {
            // Find the last tool_call message and update it
            const lastTool = [...newMessages].reverse().find((m) => m.role === 'tool' && !m.content);
            if (lastTool) {
              lastTool.content = event.result.slice(0, 1000);
              lastTool.toolDuration = event.duration;
            }
            scheduleFlush();
            break;
          }

          case 'plan':
            todos = event.todos.map((t) => ({
              ...t,
              status: t.status as TodoItem['status'],
            }));
            scheduleFlush();
            break;

          case 'response':
            newMessages.push({
              id: `resp-${Date.now()}`,
              role: 'assistant',
              content: event.content,
            });
            thinkingBuf = '';
            scheduleFlush();
            break;

          case 'compact':
            newMessages.push({
              id: `compact-${Date.now()}`,
              role: 'system',
              content: `📦 上下文压缩: ${event.reason}`,
            });
            scheduleFlush();
            break;

          case 'done':
            step = event.steps;
            done = true;
            break;

          case 'error':
            error = event.error;
            break;
        }
      }
    } catch (err: any) {
      error = err.message || String(err);
    } finally {
      // Final flush
      flush();
      setState((prev) => ({
        ...prev,
        streaming: false,
        done: true,
        error,
        usage,
        step,
      }));
    }
  }, []);

  /** 中断执行 */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, streaming: false }));
  }, []);

  return { state, run, abort };
}
