import { spawn } from 'node:child_process';
import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';
import { validatePath } from './path-utils.js';

const definition: ToolDefinition = {
  name: 'grep',
  description: '在代码库中搜索文本（支持正则表达式）。返回匹配的文件路径、行号和内容。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '搜索模式（支持正则表达式）' },
      path: { type: 'string', description: '限定搜索路径（相对于工作区根目录，可选）' },
      glob: { type: 'string', description: '文件匹配模式，如 "*.ts"（可选）' },
      ignore_case: { type: 'boolean', description: '是否忽略大小写' },
      max_results: { type: 'number', description: '最大返回条数（默认 30）' },
    },
    required: ['pattern'],
  },
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pattern = args.pattern as string;
  const searchPath = (args.path as string) || '.';
  const glob = args.glob as string | undefined;
  const ignoreCase = args.ignore_case as boolean | undefined;
  const maxResults = (args.max_results as number) || 30;

  // 校验路径
  const absPath = validatePath(searchPath, ctx.workspaceRoot);

  // 优先用 rg，失败则 fallback 到 grep
  try {
    return await runRipgrep(pattern, absPath, glob, ignoreCase, maxResults, ctx);
  } catch (err: any) {
    if (err.status === 1 || err.code === 1) {
      return { content: `未找到匹配 "${pattern}" 的结果。` };
    }
    // rg 不可用，fallback
    return await fallbackGrep(pattern, absPath, ignoreCase, maxResults, ctx);
  }
}

function runRipgrep(
  pattern: string,
  searchPath: string,
  glob?: string,
  ignoreCase?: boolean,
  maxResults?: number,
  ctx?: ToolContext,
): Promise<ToolResult> {
  const args = ['--no-heading', '--line-number', '--color=never', '-m', String(maxResults || 30)];
  if (ignoreCase) args.push('-i');
  if (glob) args.push('-g', glob);
  args.push('--', pattern, searchPath);

  return spawnToResult('rg', args, ctx);
}

function fallbackGrep(
  pattern: string,
  dir: string,
  ignoreCase: boolean | undefined,
  maxResults: number,
  ctx: ToolContext,
): Promise<ToolResult> {
  const args = ['-r', '-n', '-m', String(maxResults)];
  if (ignoreCase) args.push('-i');
  args.push('--', pattern, dir);

  return spawnToResult('grep', args, ctx);
}

function spawnToResult(cmd: string, args: string[], ctx?: ToolContext): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ctx?.workspaceRoot,
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 0) {
          resolve({ content: '未找到匹配结果。' });
        } else {
          resolve({
            content: [`找到 ${lines.length} 条匹配：`, ...lines].join('\n'),
          });
        }
      } else {
        resolve({ content: `搜索失败: ${stderr || `exit code ${code}`}`, error: 'grep_error' });
      }
    });

    child.on('error', (err) => {
      resolve({ content: `搜索失败: ${err.message}`, error: 'grep_error' });
    });
  });
}

export const grepTool: Tool = { definition, execute };
