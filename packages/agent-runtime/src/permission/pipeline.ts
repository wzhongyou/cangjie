/**
 * 权限流水线 — 不可绕过的安全代码路径
 *
 * 关键设计：权限检查在 Agent Loop 之外独立运行
 * 即使 LLM 被 jailbreak，也无法绕过权限系统
 */

import type { PermissionDecision, PermissionAction } from '@cangjie/shared';

interface PermissionConfig {
  autoAllowReadOnly: boolean;
  rules: Array<{ tool: string; pattern?: string; action: PermissionAction }>;
}

const RISK_LEVELS: Record<string, PermissionAction> = {
  read_file: 'allow',
  grep: 'allow',
  glob: 'allow',
  lsp_goto_def: 'allow',
  lsp_find_refs: 'allow',
  search_code: 'allow',
  web_search: 'allow',
  web_fetch: 'allow',
  write_file: 'ask',
  edit_file: 'ask',
  bash: 'ask',
  task: 'allow',
  todo_write: 'allow',
};

export class PermissionPipeline {
  constructor(private config: PermissionConfig) {}

  async check(tool: string, _args: Record<string, unknown>): Promise<PermissionDecision> {
    // 1. 先查用户配置的规则
    const rule = this.config.rules.find(r => r.tool === tool);
    if (rule) return { action: rule.action };

    // 2. 默认风险分级
    const defaultAction = RISK_LEVELS[tool] ?? 'ask';

    // 3. 自动放行只读工具
    if (this.config.autoAllowReadOnly && defaultAction === 'allow') {
      return { action: 'allow' };
    }

    if (defaultAction === 'allow') return { action: 'allow' };
    if (defaultAction === 'deny') return { action: 'deny', reason: 'This tool is blocked by default' };

    // 'ask' — 需要用户确认
    return { action: 'ask', reason: 'This tool requires your approval' };
  }
}
