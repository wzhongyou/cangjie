import { spawn } from 'node:child_process';
import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';

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
  if (!command || typeof command !== 'string') {
    return { content: 'bash: 缺少 command 参数', error: 'invalid_args' };
  }
  const timeout = (args.timeout as number) || 30000;

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: ctx.workspaceRoot,
      shell: true,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: ctx.signal,
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        USER: process.env.USER,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      stdout += text;
      // 限制内存
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(0, 1024 * 1024);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
      if (stderr.length > 512 * 1024) {
        stderr = stderr.slice(0, 512 * 1024);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ content: stdout || '(命令执行成功，无输出)' });
      } else {
        const output = [stdout, stderr].filter(Boolean).join('\n');
        resolve({
          content: output || `命令执行失败 (exit code: ${code})`,
          error: code === null ? 'timeout' : 'exec_error',
        });
      }
    });

    child.on('error', (err: any) => {
      resolve({ content: `命令执行失败: ${err.message}`, error: 'exec_error' });
    });
  });
}

export const bashTool: Tool = { definition, execute };
