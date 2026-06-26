/**
 * 权限流水线 — 不可绕过的安全代码路径
 *
 * 关键设计：权限检查在 Agent Loop 之外独立运行
 * 即使 LLM 被 jailbreak，也无法绕过权限系统
 *
 * v0.1 改进：onAsk 回调支持异步用户确认
 */

import type { PermissionAction, PermissionDecision } from '@cangjie/shared';

interface PermissionConfig {
  autoAllowReadOnly: boolean;
  rules: Array<{ tool: string; pattern?: string; action: PermissionAction }>;
}

/** 用户确认回调：当决策为 'ask' 时调用，返回最终决策 */
export type AskHandler = (tool: string, args: Record<string, unknown>) => Promise<PermissionDecision>;

const RISK_LEVELS: Record<string, PermissionAction> = {
  read_file: 'allow',
  grep: 'allow',
  glob: 'allow',
  todo_write: 'allow',
  web_fetch: 'ask',
  web_search: 'ask',
  write_file: 'ask',
  edit_file: 'ask',
  bash: 'ask',
};

export class PermissionPipeline {
  private onAskHandler: AskHandler | null = null;

  constructor(private config: PermissionConfig) {}

  /** 注册用户确认回调 */
  onAsk(handler: AskHandler): void {
    this.onAskHandler = handler;
  }

  async check(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
    // 1. 先查用户配置的规则
    const rule = this.config.rules.find((r) => r.tool === tool);
    if (rule) return { action: rule.action };

    // 2. 默认风险分级
    const defaultAction = RISK_LEVELS[tool] ?? 'ask';

    // 3. 自动放行只读工具
    if (this.config.autoAllowReadOnly && defaultAction === 'allow') {
      return { action: 'allow' };
    }

    if (defaultAction === 'allow') return { action: 'allow' };
    if (defaultAction === 'deny') return { action: 'deny', reason: 'This tool is blocked by default' };

    // 4. 'ask' — 通过回调让用户确认；没有回调则原样返回让调用方处理
    if (this.onAskHandler) {
      return await this.onAskHandler(tool, args);
    }

    return { action: 'ask', reason: 'This tool requires your approval' };
  }
}
