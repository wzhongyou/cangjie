/**
 * Agent Service — VSCode Extension 和 Agent Runtime 之间的桥接层
 *
 * 职责：
 * 1. 读取 VSCode 配置初始化 Agent
 * 2. 将 Agent 事件流转发给 Chat Webview
 * 3. 提供工具所需的工作区上下文
 * 4. 权限确认桥接
 * 5. 文件变更追踪（Diff Review）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CangjieAgent, createLlmClient, PermissionPipeline, ToolRegistry } from '@cangjie/core';
import type { AgentEvent, CangjieConfig, PermissionDecision, Tool } from '@cangjie/shared';
import * as vscode from 'vscode';
import type { FileChange } from '../webview/diff-panel.js';

/** 权限确认回调：AgentService → Webview → 用户 → 返回决策 */
export type PermissionAskCallback = (tool: string, args: Record<string, unknown>) => Promise<PermissionDecision>;

export class AgentService {
  private agent: CangjieAgent | null = null;

  /** 从 VSCode 配置构建 CangjieConfig */
  private getConfig(): CangjieConfig {
    const cfg = vscode.workspace.getConfiguration('cangjie');
    return {
      llm: {
        provider: cfg.get('llm.provider', 'anthropic'),
        apiKey: cfg.get('llm.apiKey', '') || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '',
        model:
          cfg.get('llm.model', 'claude-sonnet-4-6') ||
          process.env.ANTHROPIC_MODEL ||
          process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
          'claude-sonnet-4-6',
        maxTokens: 8192,
      },
      permissions: {
        autoAllowReadOnly: cfg.get('autoAllowReadOnly', true),
        rules: [],
      },
      context: {
        maxHistoryTokens: 100000,
        compactionThreshold: 0.85,
      },
    };
  }

  /** 本次 Agent 执行 */
  async *run(
    userMessage: string,
    signal?: AbortSignal,
    onPermissionAsk?: PermissionAskCallback,
  ): AsyncGenerator<AgentEvent> {
    const config = this.getConfig();

    if (!config.llm.apiKey) {
      yield { type: 'error', error: '请先设置 API Key（环境变量或 VSCode 配置 cangjie.llm.apiKey）' };
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // 构建 LLM 客户端
    const llm = createLlmClient({
      provider: config.llm.provider,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
    });

    // 文件变更追踪
    const fileChanges: FileChange[] = [];

    // 注册工具（包装 write_file / edit_file 以追踪变更）
    const tools = this.createTrackedToolRegistry(workspaceRoot, fileChanges);

    // 构建权限管线
    const permission = new PermissionPipeline(config.permissions);
    if (onPermissionAsk) {
      permission.onAsk(async (tool, args) => {
        return await onPermissionAsk(tool, args);
      });
    }

    // 构建 Agent
    this.agent = new CangjieAgent(llm, tools, {
      config,
      workspaceRoot,
      sessionId: `session-${Date.now()}`,
    });

    // 注入自定义权限管线
    (this.agent as any).permission = permission;

    // 获取当前编辑器上下文注入 prompt
    const editorContext = this.getEditorContext();
    const systemPrompt = this.buildSystemPrompt();

    for await (const event of this.agent.run(
      {
        prompt: editorContext ? `${userMessage}\n\n[当前编辑器上下文]\n${editorContext}` : userMessage,
        systemPrompt,
      },
      signal,
    )) {
      yield event;
    }

    // Agent 完成后，发送文件变更事件
    for (const change of fileChanges) {
      yield {
        type: 'file_changed',
        filePath: change.filePath,
        preContent: change.preContent,
        postContent: change.postContent,
      };
    }
  }

  /** 获取本次执行产生的文件变更 */
  getFileChanges(): FileChange[] {
    return [];
  }

  /** 创建带文件追踪的 ToolRegistry */
  private createTrackedToolRegistry(workspaceRoot: string, fileChanges: FileChange[]): ToolRegistry {
    const registry = new ToolRegistry();

    // 替换 write_file 和 edit_file 为追踪版本
    const originalWrite = registry.get('write_file');
    const originalEdit = registry.get('edit_file');

    if (originalWrite) {
      const trackedWrite: Tool = {
        definition: originalWrite.definition,
        execute: async (args, ctx) => {
          const filePath = path.resolve(workspaceRoot, args.file_path as string);
          let preContent = '';
          try {
            preContent = fs.readFileSync(filePath, 'utf-8');
          } catch {}

          const result = await originalWrite.execute(args, ctx);

          if (!result.error) {
            const postContent = args.content as string;
            if (preContent !== postContent) {
              fileChanges.push({ filePath, preContent, postContent });
            }
          }
          return result;
        },
      };
      // 替换（ToolRegistry 没有 unregister，我们用新的 Agent 实例）
      (registry as any).tools.set('write_file', trackedWrite);
    }

    if (originalEdit) {
      const trackedEdit: Tool = {
        definition: originalEdit.definition,
        execute: async (args, ctx) => {
          const filePath = path.resolve(workspaceRoot, args.file_path as string);
          let preContent = '';
          try {
            preContent = fs.readFileSync(filePath, 'utf-8');
          } catch {}

          const result = await originalEdit.execute(args, ctx);

          if (!result.error) {
            let postContent = '';
            try {
              postContent = fs.readFileSync(filePath, 'utf-8');
            } catch {}
            if (preContent !== postContent) {
              fileChanges.push({ filePath, preContent, postContent });
            }
          }
          return result;
        },
      };
      (registry as any).tools.set('edit_file', trackedEdit);
    }

    return registry;
  }

  /** 获取当前编辑器上下文 */
  private getEditorContext(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';

    const document = editor.document;
    const selection = editor.selection;
    const selectedText = document.getText(selection);
    const cursorLine = selection.active.line + 1;

    let context = `文件: ${document.uri.fsPath}\n语言: ${document.languageId}\n行数: ${document.lineCount}\n光标行: ${cursorLine}`;

    if (selectedText) {
      context += `\n\n选中代码:\n\`\`\`${document.languageId}\n${selectedText}\n\`\`\``;
    } else {
      const start = Math.max(0, selection.active.line - 10);
      const end = Math.min(document.lineCount, selection.active.line + 10);
      const nearbyText = document.getText(new vscode.Range(start, 0, end, 0));
      context += `\n\n光标附近代码:\n\`\`\`${document.languageId}\n${nearbyText}\n\`\`\``;
    }

    return context;
  }

  private buildSystemPrompt(): string {
    return [
      'You are Cangjie, a code agent running in VSCode.',
      '',
      '## Tools',
      'You have tools for reading, searching, and editing code. Use them.',
      '',
      '## Rules',
      '- Before writing code, read and understand the existing code first.',
      '- Prefer edit_file (diff-based) for small changes; use write_file for new files or full rewrites.',
      '- After making changes, verify them — run tests or check for errors.',
      "- Keep responses in the user's language.",
      "- When you see [当前编辑器上下文], use that information to understand the user's focus.",
    ].join('\n');
  }

  dispose() {
    this.agent = null;
  }
}
