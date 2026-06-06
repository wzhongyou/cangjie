import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolDefinition, ToolContext, ToolResult } from '@cangjie/shared';

const definition: ToolDefinition = {
  name: 'write_file',
  description: '创建或覆盖文件。会创建不存在的父目录。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件路径（相对于工作区根目录）' },
      content: { type: 'string', description: '写入的完整内容' },
    },
    required: ['file_path', 'content'],
  },
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = path.resolve(ctx.workspaceRoot, args.file_path as string);
  const content = args.content as string;

  try {
    // 确保父目录存在
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // 检查是否已存在
    const existed = fs.existsSync(filePath);

    fs.writeFileSync(filePath, content, 'utf-8');

    const lines = content.split('\n').length;
    return {
      content: existed
        ? `已覆盖 ${args.file_path}（${lines} 行）`
        : `已创建 ${args.file_path}（${lines} 行）`,
    };
  } catch (err: any) {
    return { content: `写入失败: ${err.message}`, error: 'write_error' };
  }
}

export const writeFileTool: Tool = { definition, execute };
