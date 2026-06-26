import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';

/**
 * 任务规划工具 — Agent 用于追踪多步骤任务的进度。
 *
 * 对标 Claude Code TodoWrite / Codex update_plan / openCode todowrite。
 *
 * 状态存储在内存中（Agent 当前会话），不作为文件持久化。
 * 工具调用时传入完整 todos 列表替换旧列表。
 */
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

/** 当前会话的 todos 状态（模块级，跟随进程生命周期） */
let currentTodos: Array<{ id: string; content: string; status: string }> = [];

export function getCurrentTodos() {
  return currentTodos;
}

export function clearTodos() {
  currentTodos = [];
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

  currentTodos = todos;

  const statusCounts = {
    pending: todos.filter((t) => t.status === 'pending').length,
    in_progress: todos.filter((t) => t.status === 'in_progress').length,
    completed: todos.filter((t) => t.status === 'completed').length,
  };

  const lines = [
    `任务清单已更新（${todos.length} 项）：`,
    `  ⏳ 待处理: ${statusCounts.pending}`,
    `  🔄 进行中: ${statusCounts.in_progress}`,
    `  ✅ 已完成: ${statusCounts.completed}`,
    '',
    ...todos.map((t) => {
      const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
      return `  ${icon} [${t.id}] ${t.content}`;
    }),
  ];

  return { content: lines.join('\n') };
}

export const todoWriteTool: Tool = { definition, execute };
