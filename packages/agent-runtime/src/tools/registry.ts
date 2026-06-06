/**
 * 工具注册中心 — 管理 Agent 可用的所有工具
 */

import type { Tool, ToolDefinition } from '@cangjie/shared';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool already registered: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 导出给 LLM 的工具定义（JSON Schema） */
  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 批量注册内置工具 */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }
}
