import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';
import { validatePath } from './path-utils.js';

const definition: ToolDefinition = {
  name: 'glob',
  description:
    '按 glob 模式查找文件或列出目录内容。返回匹配的文件路径列表。适合用来了解项目结构、找到特定扩展名的文件。',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'glob 模式，如 "**/*.ts"、"src/**/*.test.ts"、"."（列出目录）',
      },
      path: {
        type: 'string',
        description: '搜索根目录（相对于工作区，默认 "."）',
      },
    },
    required: ['pattern'],
  },
};

/**
 * 简单的 glob 实现（不依赖外部包）。
 * 支持 ** 递归匹配、* 单层匹配。
 */
function simpleGlob(root: string, pattern: string, maxResults = 200): string[] {
  const results: string[] = [];
  const parts = pattern.replace(/\\/g, '/').split('/');

  function walk(dir: string, partIndex: number): void {
    if (results.length >= maxResults) return;
    if (partIndex >= parts.length) {
      results.push(path.relative(root, dir));
      return;
    }

    const currentPart = parts[partIndex];
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 无权限或不存在，跳过
    }

    // 排序：目录在前，字母序
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= maxResults) return;

      // 跳过隐藏文件和常见忽略目录
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (
        entry.isDirectory() &&
        ['node_modules', 'dist', '.git', '__pycache__', 'target', 'build'].includes(entry.name)
      )
        continue;

      if (matchSegment(entry.name, currentPart)) {
        const fullPath = path.join(dir, entry.name);

        if (currentPart === '**') {
          // **: 匹配当前层级 + 递归
          if (entry.isDirectory()) {
            const remaining = parts.slice(partIndex).join('/');
            if (remaining !== '**') {
              walk(fullPath, partIndex + 1);
            }
            walk(fullPath, partIndex); // 递归
          } else if (partIndex === parts.length - 1) {
            results.push(path.relative(root, fullPath));
          }
        } else if (entry.isDirectory() && partIndex < parts.length - 1) {
          walk(fullPath, partIndex + 1);
        } else if (!entry.isDirectory() && partIndex === parts.length - 1) {
          results.push(path.relative(root, fullPath));
        }
      }
    }
  }

  walk(root, 0);
  return results.slice(0, maxResults);
}

function matchSegment(name: string, segment: string): boolean {
  if (segment === '*' || segment === '**') return true;

  // 将 glob 模式转为正则
  const regexStr = segment
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i').test(name);
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pattern = (args.pattern as string) || '.';
  const searchPath = validatePath((args.path as string) || '.', ctx.workspaceRoot);

  try {
    const stat = fs.statSync(searchPath);
    if (!stat.isDirectory()) {
      return { content: `路径不是目录: ${args.path || '.'}`, error: 'not_a_directory' };
    }

    const files = simpleGlob(searchPath, pattern);

    if (files.length === 0) {
      return { content: `未找到匹配 "${pattern}" 的文件。` };
    }

    const maxShow = 100;
    const shown = files.slice(0, maxShow);
    const suffix = files.length > maxShow ? `\n... 还有 ${files.length - maxShow} 个文件未显示` : '';

    return {
      content: [`找到 ${files.length} 个匹配 "${pattern}" 的文件：`, '', ...shown, suffix].join('\n'),
    };
  } catch (err: any) {
    return { content: `glob 失败: ${err.message}`, error: 'glob_error' };
  }
}

export const globTool: Tool = { definition, execute };
