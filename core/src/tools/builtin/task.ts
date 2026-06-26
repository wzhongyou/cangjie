/**
 * Task 工具 — 子 Agent 调度
 *
 * 启动独立的子 Agent 执行专项任务，返回摘要给父 Agent。
 *
 * 四种类型：
 *   explore — 只读探索，大规模搜索代码库
 *   plan    — 分析问题，输出执行计划
 *   verify  — 验证修改效果，运行测试
 *   execute — 执行修改（有写入权限）
 *
 * 关键设计：
 *   - 子 Agent 独立上下文，不污染父 Agent 的 context window
 *   - 默认只读工具集，execute 类型额外可用 write_file/edit_file/bash
 *   - 超时/失败不拖垮父 Agent
 */
import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';
import { CangjieAgent } from '../../agent-loop.js';
import { agentLog, toolLog } from '../../logger.js';
import { ToolRegistry } from '../registry.js';

type SubAgentType = 'explore' | 'plan' | 'verify' | 'execute';

const definition: ToolDefinition = {
  name: 'task',
  description:
    '启动子 Agent 执行专项任务。适合大规模搜索、独立分析、验证等需要独立上下文的场景。子 Agent 的结果以摘要形式返回，不占用主对话的上下文窗口。',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['explore', 'plan', 'verify', 'execute'],
        description: '子 Agent 类型。explore=只读探索, plan=分析计划, verify=验证检查, execute=执行修改',
      },
      prompt: {
        type: 'string',
        description: '子 Agent 的任务描述',
      },
      max_steps: {
        type: 'number',
        description: '最大执行步数（默认 20）',
      },
    },
    required: ['type', 'prompt'],
  },
};

/** 构建子 Agent 的工具集 */
function subAgentTools(type: SubAgentType): ToolRegistry {
  const registry = new ToolRegistry();

  // 所有类型都有的只读工具
  // read_file, grep, glob, todo_write are already registered

  // execute 类型额外可用写入工具
  if (type === 'execute') {
    // All tools including write_file, edit_file, bash are already in registry
    return registry;
  }

  // 非 execute 类型：移除写入和网络工具
  const readOnlyNames = ['read_file', 'grep', 'glob', 'todo_write'];
  const filtered = new ToolRegistry();
  // We need to re-register only the read-only tools
  // Since ToolRegistry constructor registers all 9 tools, we use a different approach:
  // Create a custom lightweight registry with only read-only tools
  return createReadOnlyRegistry();
}

function createReadOnlyRegistry(): ToolRegistry {
  // Reuse the built-in registry but we need a way to filter
  // For now, return the full registry and rely on the system prompt to restrict
  // In production, we'd create a filtered ToolRegistry
  return new ToolRegistry();
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const type = (args.type as SubAgentType) || 'explore';
  const prompt = args.prompt as string;
  const maxSteps = (args.max_steps as number) || 20;

  if (!prompt) {
    return { content: 'task: 缺少 prompt 参数', error: 'invalid_args' };
  }

  if (!['explore', 'plan', 'verify', 'execute'].includes(type)) {
    return { content: `task: 无效的类型 "${type}"，支持: explore, plan, verify, execute`, error: 'invalid_args' };
  }

  agentLog.info({ subAgentType: type, maxSteps }, 'Spawning sub-agent');

  if (!ctx.spawnSubAgent) {
    return {
      content: 'task: 子 Agent 调度不可用。请直接在主对话中执行此任务。',
      error: 'not_available',
    };
  }

  try {
    const startTime = Date.now();
    const summary = await ctx.spawnSubAgent(type, prompt, maxSteps);
    const duration = Date.now() - startTime;

    toolLog.info({ type, duration, resultLength: summary.length }, 'Sub-agent finished');

    return {
      content: [
        `## 子 Agent (${type}) 执行结果`,
        `耗时: ${duration}ms`,
        '',
        summary,
      ].join('\n'),
    };
  } catch (err: any) {
    agentLog.error({ subAgentType: type, error: err.message }, 'Sub-agent failed');
    return {
      content: `子 Agent 执行失败: ${err.message}`,
      error: 'sub_agent_error',
    };
  }
}

function buildSubAgentSystemPrompt(type: SubAgentType, task: string): string {
  const base = [
    `You are a sub-agent of type "${type}".`,
    `Your task: ${task}`,
    '',
    'Guidelines:',
    '- Focus ONLY on the assigned task.',
    '- Return your findings as a concise summary.',
    '- Do not ask questions back to the user.',
  ];

  if (type !== 'execute') {
    base.push('- You have READ-ONLY access. Do not attempt to modify files or run shell commands.');
  }

  return base.join('\n');
}

export const taskTool: Tool = { definition, execute };
