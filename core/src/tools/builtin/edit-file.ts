import * as fs from 'node:fs';
import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';
import { checkFileSize, MAX_READ_SIZE, validatePath } from './path-utils.js';

const definition: ToolDefinition = {
  name: 'edit_file',
  description: `精确替换文件中的一段文本（diff 式编辑）。
必须匹配到唯一的 old_string，用 new_string 替换。
old_string 必须包含完整的行，包含所有缩进和空格。`,
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件路径（相对于工作区根目录）' },
      old_string: { type: 'string', description: '要替换的原始文本（必须完全匹配，包含缩进和空行）' },
      new_string: { type: 'string', description: '替换后的新文本' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = validatePath(args.file_path as string, ctx.workspaceRoot);
  const oldStr = args.old_string as string;
  const newStr = args.new_string as string;

  try {
    checkFileSize(filePath, MAX_READ_SIZE);
    const content = fs.readFileSync(filePath, 'utf-8');

    // 精确匹配
    const index = content.indexOf(oldStr);
    if (index === -1) {
      return { content: `替换失败: old_string 未匹配到唯一位置。请检查缩进和空行是否完全一致。`, error: 'no_match' };
    }

    // 确保只匹配一次
    const secondIndex = content.indexOf(oldStr, index + 1);
    if (secondIndex !== -1) {
      return { content: `替换失败: old_string 匹配到多处。请提供更多上下文使匹配唯一。`, error: 'multiple_matches' };
    }

    const newContent = content.slice(0, index) + newStr + content.slice(index + oldStr.length);
    fs.writeFileSync(filePath, newContent, 'utf-8');

    // 生成简短的 diff 描述
    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;
    return {
      content: `已编辑 ${args.file_path}（${oldLines} 行 → ${newLines} 行）`,
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { content: `文件不存在: ${args.file_path}`, error: 'not_found' };
    return { content: `编辑失败: ${err.message}`, error: 'edit_error' };
  }
}

export const editFileTool: Tool = { definition, execute };
