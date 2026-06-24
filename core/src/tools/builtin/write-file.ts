import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';
import { MAX_WRITE_SIZE, validatePath } from './path-utils.js';

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
  const filePath = validatePath(args.file_path as string, ctx.workspaceRoot);
  const content = args.content as string;

  // 内容大小校验
  if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_SIZE) {
    return { content: `写入失败: 内容过大`, error: 'write_error' };
  }

  try {
    // 确保父目录存在
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // 检查是否已存在
    const existed = fs.existsSync(filePath);

    // 原子写入：先写临时文件，再 rename
    const tmpPath = filePath + '.cangjie_tmp';
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);

    const lines = content.split('\n').length;
    return {
      content: existed ? `已覆盖 ${args.file_path}（${lines} 行）` : `已创建 ${args.file_path}（${lines} 行）`,
    };
  } catch (err: any) {
    return { content: `写入失败: ${err.message}`, error: 'write_error' };
  }
}

export const writeFileTool: Tool = { definition, execute };
