/**
 * 结构化日志系统
 *
 * 基于 pino，模块分级输出：
 *   agent  — Agent Loop 状态变更
 *   tool   — 工具执行记录
 *   llm    — LLM API 调用记录
 *   perm   — 权限决策记录
 *
 * 输出：
 *   开发环境 → stderr（不干扰管道模式的 stdout）
 *   生产环境 → ~/.cangjie/logs/
 */
import pino from 'pino';

export type LogModule = 'agent' | 'tool' | 'llm' | 'perm';

export interface LogContext {
  module: LogModule;
  sessionId?: string;
  step?: number;
  toolName?: string;
  model?: string;
  [key: string]: unknown;
}

const root = pino({
  level: process.env.CANGJIE_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  // Plain JSON to stderr. Pipe through pino-pretty in dev if desired.
  // Bun-compiled binary can't spawn pino-pretty as child process.
});

/** 创建模块级子 logger */
export function createLogger(module: LogModule, ctx?: Partial<LogContext>) {
  return root.child({ module, ...ctx });
}

// ============================================================
// 预置模块 logger
// ============================================================

/** Agent Loop 运行日志 */
export const agentLog = createLogger('agent');

/** 工具执行日志 */
export const toolLog = createLogger('tool');

/** LLM 调用日志 */
export const llmLog = createLogger('llm');

/** 权限决策日志 */
export const permLog = createLogger('perm');
