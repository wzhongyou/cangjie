import { execSync } from 'node:child_process';
import type { Tool, ToolDefinition, ToolContext, ToolResult } from '@cangjie/shared';

const definition: ToolDefinition = {
  name: 'bash',
  description: '在终端执行命令。长时间运行的命令会被超时中断（默认 30 秒）。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 Shell 命令' },
      timeout: { type: 'number', description: '超时毫秒数（默认 30000）' },
    },
    required: ['command'],
  },
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const command = args.command as string;
  const timeout = (args.timeout as number) || 30000;

  try {
    const stdout = execSync(command, {
      cwd: ctx.workspaceRoot,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { content: stdout || '(命令执行成功，无输出)' };
  } catch (err: any) {
    if (err.killed) {
      return { content: `命令超时（${timeout}ms）`, error: 'timeout' };
    }
    // stderr + stdout 合并
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
    return { content: output || `命令执行失败: ${err.message}`, error: 'exec_error' };
  }
}

export const bashTool: Tool = { definition, execute };
