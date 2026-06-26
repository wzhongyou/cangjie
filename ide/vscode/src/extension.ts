/**
 * Cangjie VSCode Extension 入口
 *
 * 职责：
 * 1. 注册命令（Open Chat / Inline Edit / Explain Code）
 * 2. 管理 Chat Webview Panel
 * 3. 桥接 VSCode Editor API 和 Agent Runtime
 */

import type { AgentEvent, PermissionDecision } from '@cangjie/shared';
import * as vscode from 'vscode';
import { AgentService } from './services/agent-service.js';
import { ChatPanel } from './webview/chat-panel.js';
import type { FileChange } from './webview/diff-panel.js';
import { DiffPanel } from './webview/diff-panel.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('Cangjie activated');

  // 注册命令：打开对话面板
  context.subscriptions.push(
    vscode.commands.registerCommand('cangjie.openChat', () => {
      ChatPanel.createOrShow(context);
    }),
  );

  // 注册命令：行内编辑（Cmd+K 触发）
  context.subscriptions.push(
    vscode.commands.registerCommand('cangjie.inlineEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const selectedText = editor.document.getText(
        selection.isEmpty
          ? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount, 0))
          : selection,
      );

      const instruction = await vscode.window.showInputBox({
        prompt: '告诉 Cangjie 你想怎么做？',
        placeHolder: '例如：优化这段代码 / 加错误处理 / 改成 async/await',
      });

      if (!instruction) return;

      const agentService = new AgentService();
      const controller = new AbortController();
      const fileChanges: FileChange[] = [];

      // inlineEdit 模式的权限确认：通过 QuickPick
      const permissionCallback = async (tool: string, args: Record<string, unknown>): Promise<PermissionDecision> => {
        const choice = await vscode.window.showQuickPick(['Allow', 'Deny'], {
          placeHolder: `允许执行 ${tool}？${JSON.stringify(args).slice(0, 100)}`,
        });
        return { action: choice === 'Allow' ? 'allow' : 'deny' };
      };

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Cangjie 正在处理...',
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => controller.abort());

          for await (const event of agentService.run(
            `${instruction}\n\n代码:\n\`\`\`\n${selectedText}\n\`\`\``,
            controller.signal,
            permissionCallback,
          )) {
            if (event.type === 'tool_call') {
              progress.report({ message: `正在执行: ${event.tool}` });
            } else if (event.type === 'tool_result') {
              progress.report({ message: `${event.tool} 完成` });
            } else if (event.type === 'file_changed') {
              fileChanges.push({
                filePath: event.filePath,
                preContent: event.preContent,
                postContent: event.postContent,
              });
            } else if (event.type === 'error') {
              vscode.window.showErrorMessage(`Cangjie: ${event.error}`);
            }
          }
        },
      );

      agentService.dispose();

      // 显示 Diff Review
      if (fileChanges.length > 0) {
        DiffPanel.createOrShow(context, fileChanges);
      } else {
        vscode.window.showInformationMessage('Cangjie: 未产生文件变更');
      }
    }),
  );

  // 注册命令：解释代码
  context.subscriptions.push(
    vscode.commands.registerCommand('cangjie.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText) {
        vscode.window.showWarningMessage('请先选中需要解释的代码');
        return;
      }

      // 打开 Chat 面板并发送解释请求
      const panel = ChatPanel.createOrShow(context);
      panel.sendMessage(`解释这段代码：\n\`\`\`\n${selectedText}\n\`\`\``);
    }),
  );
}

export function deactivate() {
  console.log('Cangjie deactivated');
}
