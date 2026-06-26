/**
 * TaskState — 任务执行状态管理
 *
 * 替代 todo-write.ts 中的模块级变量，支持：
 *  - 状态机：planning → executing → verifying → done
 *  - StepRecord 执行追踪
 *  - 跨轮次状态保持
 */
import { agentLog } from './logger.js';

export type TaskPhase = 'planning' | 'executing' | 'verifying' | 'done';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  completedAt?: string;
}

export interface StepRecord {
  step: number;
  type: 'think' | 'tool_call' | 'tool_result' | 'response';
  detail: string;
  toolName?: string;
  duration?: number;
  tokenUsage?: { input: number; output: number };
  timestamp: string;
}

export class TaskState {
  todos: TodoItem[] = [];
  currentStep = 0;
  phase: TaskPhase = 'planning';
  executionTrace: StepRecord[] = [];

  /** 更新任务清单 */
  updateTodos(items: Array<{ id: string; content: string; status: string }>): void {
    const now = new Date().toISOString();
    this.todos = items.map((item) => {
      const existing = this.todos.find((t) => t.id === item.id);
      const completedAt =
        item.status === 'completed' && existing?.status !== 'completed' ? now : existing?.completedAt;

      return {
        id: item.id,
        content: item.content,
        status: item.status as TodoItem['status'],
        createdAt: existing?.createdAt ?? now,
        completedAt,
      };
    });

    // Auto-advance phase
    const allDone = this.todos.length > 0 && this.todos.every((t) => t.status === 'completed');
    const hasInProgress = this.todos.some((t) => t.status === 'in_progress');

    if (allDone) {
      this.transition('done');
    } else if (hasInProgress || this.todos.some((t) => t.status === 'completed')) {
      this.transition('executing');
    }
  }

  /** 记录执行步骤 */
  recordStep(record: Omit<StepRecord, 'timestamp'>): void {
    this.currentStep = record.step;
    this.executionTrace.push({
      ...record,
      timestamp: new Date().toISOString(),
    });
  }

  /** 状态迁移 */
  transition(phase: TaskPhase): void {
    if (this.phase !== phase) {
      agentLog.debug({ from: this.phase, to: phase }, 'Task phase transition');
      this.phase = phase;
    }
  }

  /** 获取进度摘要 */
  summary(): { total: number; completed: number; inProgress: number; pending: number } {
    return {
      total: this.todos.length,
      completed: this.todos.filter((t) => t.status === 'completed').length,
      inProgress: this.todos.filter((t) => t.status === 'in_progress').length,
      pending: this.todos.filter((t) => t.status === 'pending').length,
    };
  }

  /** 重置状态 */
  reset(): void {
    this.todos = [];
    this.currentStep = 0;
    this.phase = 'planning';
    this.executionTrace = [];
  }
}
