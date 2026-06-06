import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolDefinition, ToolContext, ToolResult } from '@cangjie/shared';

const definition: ToolDefinition = {
  name: 'read_file',
  description: '读取文件内容。可以指定起始行和行数。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件路径（相对于工作区根目录）' },
      offset: { type: 'number', description: '起始行号（从 1 开始）' },
      limit: { type: 'number', description: '读取行数' },
    },
    required: ['file_path'],
  },
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = path.resolve(ctx.workspaceRoot, args.file_path as string);
  const offset = (args.offset as number) || 1;
  const limit = args.limit as number | undefined;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const startLine = Math.max(0, offset - 1);
    const endLine = limit ? startLine + limit : lines.length;
    const sliced = lines.slice(startLine, endLine);

    return {
      content: sliced
        .map((line, i) => `${String(startLine + i + 1).padStart(4, ' ')}| ${line}`)
        .join('\n'),
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { content: `文件不存在: ${filePath}`, error: 'not_found' };
    return { content: `读取失败: ${err.message}`, error: 'read_error' };
  }
}

export const readFileTool: Tool = { definition, execute };
