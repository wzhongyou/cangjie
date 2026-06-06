import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { Tool, ToolDefinition, ToolContext, ToolResult } from '@cangjie/shared';

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

  const absPath = path.resolve(ctx.workspaceRoot, searchPath);
  const cmd = buildRipgrepCommand(pattern, absPath, glob, ignoreCase, maxResults);

  try {
    const stdout = execSync(cmd, {
      cwd: ctx.workspaceRoot,
      timeout: 10000,
      maxBuffer: 1024 * 500,
      encoding: 'utf-8',
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      return { content: `未找到匹配 "${pattern}" 的结果。` };
    }

    return {
      content: [`找到 ${lines.length} 条匹配 "${pattern}"：`, ...lines.slice(0, maxResults)].join('\n'),
    };
  } catch (err: any) {
    // rg returns exit code 1 for "no matches"
    if (err.status === 1 || err.code === 1) {
      return { content: `未找到匹配 "${pattern}" 的结果。` };
    }
    // rg not installed, fallback to grep
    return fallbackGrep(pattern, absPath, ignoreCase, maxResults, ctx);
  }
}

function buildRipgrepCommand(pattern: string, path: string, glob?: string, ignoreCase?: boolean, maxResults?: number): string {
  const args = ['--no-heading', '--line-number', '--color=never', '-m', String(maxResults || 30)];
  if (ignoreCase) args.push('-i');
  if (glob) args.push('-g', glob);
  args.push(pattern, path);
  return `rg ${args.join(' ')}`;
}

function fallbackGrep(pattern: string, dir: string, ignoreCase: boolean | undefined, maxResults: number, ctx: ToolContext): ToolResult {
  try {
    const grepArgs = ['-r', '-n', '--include=*'];
    if (ignoreCase) grepArgs.push('-i');
    grepArgs.push(pattern, dir);

    const stdout = execSync(`grep ${grepArgs.join(' ')}`, {
      cwd: ctx.workspaceRoot,
      timeout: 10000,
      maxBuffer: 1024 * 500,
      encoding: 'utf-8',
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      return { content: `未找到匹配 "${pattern}" 的结果。` };
    }

    return {
      content: [`找到 ${lines.length} 条匹配 "${pattern}"：`, ...lines.slice(0, maxResults)].join('\n'),
    };
  } catch (err: any) {
    if (err.status === 1) return { content: `未找到匹配 "${pattern}" 的结果。` };
    return { content: `搜索失败: ${err.message}`, error: 'grep_error' };
  }
}

export const grepTool: Tool = { definition, execute };
