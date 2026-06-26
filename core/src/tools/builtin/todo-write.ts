import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';
import { TaskState } from '../../task-state.js';

/**
 * 任务规划工具 — Agent 用于追踪多步骤任务的进度。
 *
 * 状态存储在 TaskState 实例中，支持状态机流转和 StepRecord 追踪。
 */
const taskState = new TaskState();

export { taskState };
const definition: ToolDefinition = {
  name: 'todo_write',
  description:
    '管理任务清单，用于规划和追踪多步骤任务的进度。传入完整的 todos 列表来替换当前列表。每个 todo 包含 id（唯一标识）、content（描述）、status（pending|in_progress|completed）。任务完成后应更新 status 而非删除。',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '完整的任务列表（会替换旧列表）',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '唯一标识符' },
            content: { type: 'string', description: '任务描述' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: '任务状态',
            },
          },
          required: ['id', 'content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
};

export function getCurrentTodos() {
  return taskState.todos;
}

export function clearTodos() {
  taskState.reset();
}

async function execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
  const todos = args.todos as Array<{ id: string; content: string; status: string }> | undefined;

  if (!todos || !Array.isArray(todos)) {
    return { content: 'todo_write: 缺少 todos 参数', error: 'invalid_args' };
  }

  // 校验
  for (const t of todos) {
    if (!t.id || !t.content || !['pending', 'in_progress', 'completed'].includes(t.status)) {
      return {
        content: `todo_write: 无效的 todo 项: ${JSON.stringify(t)}。每个项需要 id、content、status（pending|in_progress|completed）`,
        error: 'invalid_args',
      };
    }
  }

  taskState.updateTodos(todos);

  const summary = taskState.summary();

  const lines = [
    `任务清单已更新（${todos.length} 项）：`,
    `  ⏳ 待处理: ${summary.pending}`,
    `  🔄 进行中: ${summary.inProgress}`,
    `  ✅ 已完成: ${summary.completed}`,
    `  阶段: ${taskState.phase}`,
    '',
    ...todos.map((t) => {
      const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
      return `  ${icon} [${t.id}] ${t.content}`;
    }),
  ];

  return { content: lines.join('\n') };
}

export const todoWriteTool: Tool = { definition, execute };
