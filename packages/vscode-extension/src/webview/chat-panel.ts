/**
 * Chat Webview Panel 管理
 *
 * 设计要点：
 * 1. VSCode Webview 本质是一个 iframe，通过 postMessage 通信
 * 2. Extension Host ↔ Webview 的桥梁在这个文件
 * 3. Webview 内是 React SPA，通过 Vite 构建
 */

import * as vscode from 'vscode';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(panel.webview, context);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // 接收来自 Webview 的消息
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case 'sendMessage':
            await this.handleUserMessage(msg.content);
            break;
          case 'getContext':
            await this.sendEditorContext();
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  /** 创建或显示 Chat 面板 */
  static createOrShow(context: vscode.ExtensionContext): ChatPanel {
    const column = vscode.ViewColumn.Two;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return ChatPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'cangjieChat',
      'Cangjie',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      },
    );

    ChatPanel.currentPanel = new ChatPanel(panel, context);
    return ChatPanel.currentPanel;
  }

  /** 发送消息到 Chat（从外部调用，如 explainCode 命令） */
  sendMessage(content: string) {
    this.panel.webview.postMessage({ type: 'userMessage', content });
  }

  /** 处理用户发送的消息 */
  private async handleUserMessage(content: string) {
    // 获取编辑器上下文
    const editor = vscode.window.activeTextEditor;
    const context = editor
      ? `当前文件: ${editor.document.uri.fsPath}\n语言: ${editor.document.languageId}\n选择范围: ${editor.selection.start.line}:${editor.selection.start.character}-${editor.selection.end.line}:${editor.selection.end.character}`
      : '';

    // TODO: 调用 Agent Runtime
    this.panel.webview.postMessage({
      type: 'assistantMessage',
      content: `收到你的消息: "${content}"\n\n${context}\n\n> Agent Runtime 集成中, 目前为 Demo 模式...`,
    });
  }

  /** 发送当前编辑器上下文到 Webview */
  private async sendEditorContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    this.panel.webview.postMessage({
      type: 'editorContext',
      filePath: editor.document.uri.fsPath,
      language: editor.document.languageId,
      selection: editor.document.getText(editor.selection),
    });
  }

  private getHtml(webview: vscode.Webview, _context: vscode.ExtensionContext): string {
    // MVP 阶段内联 HTML，后续改为 Vite 构建产物
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
  <title>Cangjie</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); padding: 16px; font-size: 14px; }
    #chat { display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; margin-bottom: 12px; }
    .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; max-width: 85%; }
    .msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
    .msg.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
    #input-area { display: flex; gap: 8px; }
    #input { flex: 1; padding: 10px; border: 1px solid var(--vscode-input-border); border-radius: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; font-size: 14px; resize: none; }
    #send { padding: 10px 20px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 8px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="chat">
    <div id="messages">
      <div class="msg assistant">你好，我是 Cangjie。有什么可以帮你？</div>
    </div>
    <div id="input-area">
      <textarea id="input" rows="3" placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"></textarea>
      <button id="send">发送</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    function addMessage(content, role) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = content;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      vscode.postMessage({ type: 'sendMessage', content: text });
      inputEl.value = '';
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'assistantMessage') addMessage(msg.content, 'assistant');
    });
  </script>
</body>
</html>`;
  }

  private dispose() {
    ChatPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
