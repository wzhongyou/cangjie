/**
 * Cangjie VSCode Extension 入口
 *
 * 职责：
 * 1. 注册命令（Open Chat / Inline Edit / Explain Code）
 * 2. 管理 Chat Webview Panel
 * 3. 桥接 VSCode Editor API 和 Agent Runtime
 */

import * as vscode from 'vscode';
import { ChatPanel } from './webview/chat-panel.js';

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

      if (instruction) {
        // TODO: 调用 Agent Runtime
        vscode.window.showInformationMessage(`Cangjie: ${instruction}`);
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
