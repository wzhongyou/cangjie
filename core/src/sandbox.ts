/**
 * 沙箱 — 命令注入检测 + 危险操作拦截
 *
 * 在 bash 工具执行前检查命令安全性。
 */
import { toolLog } from './logger.js';

/** 危险模式列表 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /`[^`]*`/, reason: '命令注入: backticks' },
  { pattern: /\$\([^)]*\)/, reason: '命令注入: $(...)' },
  { pattern: /\beval\b/, reason: '命令注入: eval' },
  { pattern: />\s*\/dev\/[a-z]+/, reason: '写入系统设备' },
  { pattern: /curl\s+\S+\s*\|\s*(ba)?sh/, reason: 'curl pipe shell' },
  { pattern: /wget\s+\S+\s*-O\s*-\s*\|/, reason: 'wget pipe' },
];

/** 高危命令（需要确认的危险操作） */
const HIGH_RISK_COMMANDS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\brm\s+-rf?\s+\//, warning: '递归删除根目录' },
  { pattern: /\brm\s+-rf?\s+~/, warning: '递归删除 HOME 目录' },
  { pattern: /\bchmod\s+777\b/, warning: '设置为 777 权限' },
  { pattern: /:\s*\{\s*:\s*\|\s*:\s*&\s*\}/, warning: 'fork bomb' },
  { pattern: />\s*\/etc\//, warning: '写入 /etc 目录' },
  { pattern: /\bgit\s+push\s+.*--force/, warning: '强制推送' },
  { pattern: /\bdocker\s+rm\s+-f\b/, warning: '强制删除容器' },
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, warning: '删除数据库对象' },
];

export interface SandboxCheck {
  allowed: boolean;
  reason?: string;
  warnings: string[];
}

/**
 * 检查 bash 命令是否安全。
 * 返回检查结果，包含是否允许和警告列表。
 */
export function checkBashCommand(command: string): SandboxCheck {
  const warnings: string[] = [];

  // 检查危险模式
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      toolLog.warn({ command: command.slice(0, 100), pattern: pattern.source }, 'Blocked dangerous command');
      return { allowed: false, reason, warnings };
    }
  }

  // 检查高危命令
  for (const { pattern, warning } of HIGH_RISK_COMMANDS) {
    if (pattern.test(command)) {
      warnings.push(warning);
    }
  }

  if (warnings.length > 0) {
    toolLog.warn({ command: command.slice(0, 100), warnings }, 'High-risk command detected');
  }

  return { allowed: true, warnings };
}
