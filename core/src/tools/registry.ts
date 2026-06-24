import type { Tool, ToolDefinition } from '@cangjie/shared';
import { bashTool, editFileTool, grepTool, readFileTool, writeFileTool } from './builtin/index.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor() {
    // 注册内置工具
    for (const t of [readFileTool, grepTool, writeFileTool, editFileTool, bashTool]) {
      this.register(t);
    }
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool already registered: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }
}
