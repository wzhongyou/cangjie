/**
 * Agent Service — VSCode Extension 和 Agent Runtime 之间的桥接层
 *
 * 职责：
 * 1. 读取 VSCode 配置初始化 Agent
 * 2. 将 Agent 事件流转发给 Chat Webview
 * 3. 提供工具所需的工作区上下文
 */

import * as vscode from 'vscode';
import { CangjieAgent, ToolRegistry, createLlmClient } from '@cangjie/agent-runtime';
import type { AgentEvent, CangjieConfig } from '@cangjie/shared';

export class AgentService {
  private agent: CangjieAgent | null = null;

  /** 从 VSCode 配置构建 CangjieConfig */
  private getConfig(): CangjieConfig {
    const cfg = vscode.workspace.getConfiguration('cangjie');
    return {
      llm: {
        provider: cfg.get('llm.provider', 'anthropic'),
        apiKey: cfg.get('llm.apiKey', '') || process.env.ANTHROPIC_API_KEY || '',
        model: cfg.get('llm.model', 'claude-sonnet-4-6'),
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
    });

    // 注册工具
    const tools = new ToolRegistry();

    // 构建 Agent
    this.agent = new CangjieAgent(llm, tools, {
      config,
      workspaceRoot,
      sessionId: `session-${Date.now()}`,
    });

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
      // 无选中时提供光标附近代码
      const start = Math.max(0, selection.active.line - 10);
      const end = Math.min(document.lineCount, selection.active.line + 10);
      const nearbyText = document.getText(new vscode.Range(start, 0, end, 0));
      context += `\n\n光标附近代码:\n\`\`\`${document.languageId}\n${nearbyText}\n\`\`\``;
    }

    return context;
  }

  private buildSystemPrompt(): string {
    return [
      'You are Cangjie, a code agent.',
      '',
      '## Tools',
      'You have access to tools for reading, searching, and editing code. Use them.',
      '',
      '## Rules',
      '- Before writing code, read and understand the existing code first.',
      '- Use edit_file (diff-based) to modify files, not write_file for small changes.',
      '- After making changes, verify them — run tests or check for errors.',
      '- Keep responses in the user\'s language.',
      '- When you see [当前编辑器上下文], use that information to understand what the user is looking at.',
    ].join('\n');
  }

  dispose() {
    this.agent = null;
  }
}
