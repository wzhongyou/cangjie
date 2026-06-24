import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 校验文件路径在工作区范围内，防止路径穿越攻击。
 * 返回解析后的绝对路径，如果越界则抛出错误。
 */
export function validatePath(filePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, filePath);

  // 规范化两个路径进行比较
  const normalizedFile = path.normalize(resolved);
  const normalizedRoot = path.normalize(workspaceRoot) + path.sep;

  if (!normalizedFile.startsWith(normalizedRoot) && normalizedFile !== path.normalize(workspaceRoot)) {
    throw new Error(`路径越界: ${filePath} 不在工作区范围内`);
  }

  return resolved;
}

/**
 * 检查文件大小是否超出限制
 */
export function checkFileSize(filePath: string, maxBytes: number): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
      throw new Error(
        `文件过大: ${(stat.size / 1024 / 1024).toFixed(1)}MB（限制 ${(maxBytes / 1024 / 1024).toFixed(1)}MB）`,
      );
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') return; // 文件不存在，由调用方处理
    throw err;
  }
}

/** 文件大小限制 */
export const MAX_READ_SIZE = 5 * 1024 * 1024; // 5MB 读
export const MAX_WRITE_SIZE = 5 * 1024 * 1024; // 5MB 写
