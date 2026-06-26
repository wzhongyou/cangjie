/**
 * Chat Webview Panel
 *
 * Extension Host 侧的 Chat 面板管理。
 * 负责 Webview ↔ AgentService 之间的消息转发和事件流推送。
 */

import type { AgentEvent, PermissionDecision } from '@cangjie/shared';
import * as vscode from 'vscode';
import { AgentService } from '../services/agent-service.js';
import type { FileChange } from './diff-panel.js';
import { DiffPanel } from './diff-panel.js';

/** 权限请求：等待用户确认 */
interface PendingPermission {
  tool: string;
  args: Record<string, unknown>;
  resolve: (decision: PermissionDecision) => void;
}

let permissionIdCounter = 0;

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly agentService: AgentService;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private abortController: AbortController | null = null;
  private pendingPermissions = new Map<string, PendingPermission>();

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.agentService = new AgentService();

    this.panel.webview.html = this.getHtml(panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Webview → Extension Host
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        switch (msg.type) {
          case 'sendMessage':
            this.handleUserMessage(msg.content);
            break;
          case 'abort':
            this.abortAgent();
            break;
          case 'permissionReply':
            this.handlePermissionReply(msg.id, msg.action);
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  static createOrShow(context: vscode.ExtensionContext): ChatPanel {
    const column = vscode.ViewColumn.Two;
    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return ChatPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel('cangjieChat', 'Cangjie', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    ChatPanel.currentPanel = new ChatPanel(panel, context);
    return ChatPanel.currentPanel;
  }

  /** 从外部命令触发（如 explainCode） */
  sendMessage(content: string) {
    this.panel.webview.postMessage({ type: 'userMessage', content });
  }

  /** 权限确认回调 */
  private createPermissionCallback(): (tool: string, args: Record<string, unknown>) => Promise<PermissionDecision> {
    return (tool: string, args: Record<string, unknown>): Promise<PermissionDecision> => {
      return new Promise((resolve) => {
        const id = String(++permissionIdCounter);
        this.pendingPermissions.set(id, { tool, args, resolve });

        // 发送到 Webview 弹窗
        this.postToWebview({
          type: 'permissionAsk',
          id,
          tool,
          args: JSON.stringify(args).slice(0, 300),
        });

        // 60 秒超时
        setTimeout(() => {
          if (this.pendingPermissions.has(id)) {
            this.pendingPermissions.delete(id);
            resolve({ action: 'deny', reason: '超时' });
          }
        }, 60000);
      });
    };
  }

  private handlePermissionReply(id: string, action: 'allow' | 'deny' | 'always_allow') {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return;
    this.pendingPermissions.delete(id);

    // 'always_allow' acts as allow for now (persistence deferred to v0.2)
    pending.resolve({ action: action === 'deny' ? 'deny' : 'allow' });
  }

  /** 处理用户输入 → 启动 Agent */
  private async handleUserMessage(content: string) {
    // 取消上一个请求
    this.abortAgent();
    this.abortController = new AbortController();

    this.postToWebview({ type: 'agentStart' });

    // 收集文件变更
    const fileChanges: FileChange[] = [];

    try {
      for await (const event of this.agentService.run(
        content,
        this.abortController.signal,
        this.createPermissionCallback(),
      )) {
        // 收集文件变更事件
        if (event.type === 'file_changed') {
          fileChanges.push({
            filePath: event.filePath,
            preContent: event.preContent,
            postContent: event.postContent,
          });
        }
        this.postAgentEvent(event);
      }
    } catch (err: any) {
      this.postToWebview({ type: 'agentError', error: err.message ?? String(err) });
    }

    this.postToWebview({ type: 'agentEnd' });

    // 有文件变更时，弹出 Diff Review 面板
    if (fileChanges.length > 0) {
      DiffPanel.createOrShow(this.context, fileChanges, () => {
        // 用户点击全部 Accept
        this.postToWebview({ type: 'editResult', success: true });
      });
    }
  }

  /** 将 AgentEvent 转为 Webview 消息 */
  private postAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case 'thinking':
        this.postToWebview({ type: 'agentThinking', content: event.content });
        break;
      case 'tool_call':
        this.postToWebview({ type: 'agentToolCall', tool: event.tool, args: event.args });
        break;
      case 'tool_result':
        this.postToWebview({
          type: 'agentToolResult',
          tool: event.tool,
          result: event.result,
          duration: event.duration,
        });
        break;
      case 'response':
        this.postToWebview({ type: 'agentResponse', content: event.content });
        break;
      case 'error':
        this.postToWebview({ type: 'agentError', error: event.error });
        break;
      case 'done':
        this.postToWebview({ type: 'agentDone', steps: event.steps });
        break;
      case 'file_changed':
        this.postToWebview({
          type: 'fileChanged',
          filePath: event.filePath,
          preContent: event.preContent,
          postContent: event.postContent,
        });
        break;
    }
  }

  private abortAgent() {
    this.abortController?.abort();
    this.abortController = null;
  }

  private postToWebview(msg: Record<string, unknown>) {
    this.panel.webview.postMessage(msg);
  }

  /** 内联 HTML + JS */
  private getHtml(webview: vscode.Webview): string {
    const csp = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline';">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,system-ui,sans-serif;font-size:13px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);padding:12px}
    #chat{display:flex;flex-direction:column;height:100vh}
    #messages{flex:1;overflow-y:auto;padding-bottom:8px}
    .msg{margin-bottom:10px;padding:8px 12px;border-radius:6px;max-width:90%;line-height:1.5;white-space:pre-wrap;word-break:break-word}
    .msg.user{align-self:flex-end;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    .msg.assistant{align-self:flex-start;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}
    .msg.tool_call{align-self:flex-start;background:var(--vscode-textBlockQuote-background);border-left:3px solid var(--vscode-textLink-activeForeground);font-size:12px}
    .msg.tool_result{align-self:flex-start;background:var(--vscode-textCodeBlock-background);font-family:monospace;font-size:11px;max-height:200px;overflow-y:auto}
    .msg.error{align-self:flex-start;background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-inputValidation-errorForeground);border:1px solid var(--vscode-inputValidation-errorBorder)}
    .msg.system{align-self:center;color:var(--vscode-descriptionForeground);font-size:11px;background:none;padding:2px 0}
    #input-area{display:flex;gap:8px;padding-top:8px;border-top:1px solid var(--vscode-panel-border)}
    #input{flex:1;padding:10px;border:1px solid var(--vscode-input-border);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font-family:inherit;font-size:13px;resize:none;min-height:60px}
    #input:focus{outline:1px solid var(--vscode-focusBorder)}
    #send{padding:8px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;cursor:pointer;font-size:13px;align-self:flex-end}
    #send:hover{background:var(--vscode-button-hoverBackground)}
    #send:disabled{opacity:.5}
    /* Permission prompt */
    #permission-bar{display:none;padding:10px 12px;margin-bottom:8px;background:var(--vscode-editorWarning-background);border:1px solid var(--vscode-editorWarning-border);border-radius:6px;font-size:12px}
    #permission-bar .perm-tool{font-weight:bold;color:var(--vscode-textLink-foreground);margin-bottom:4px}
    #permission-bar .perm-args{font-family:monospace;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;max-height:60px;overflow-y:auto}
    #permission-bar .perm-btns{display:flex;gap:8px}
    .perm-btn{padding:4px 12px;border-radius:4px;border:none;cursor:pointer;font-size:12px}
    .perm-btn.allow{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    .perm-btn.deny{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
    .thinking{display:inline-block;width:8px;height:8px;background:var(--vscode-textLink-foreground);border-radius:50%;animation:pulse .8s infinite}
    @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
  </style>
</head>
<body>
<div id="chat">
  <div id="permission-bar">
    <div class="perm-tool" id="perm-tool"></div>
    <div class="perm-args" id="perm-args"></div>
    <div class="perm-btns">
      <button class="perm-btn allow" id="perm-allow">允许</button>
      <button class="perm-btn allow" id="perm-always">始终允许</button>
      <button class="perm-btn deny" id="perm-deny">拒绝</button>
    </div>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <textarea id="input" rows="2" placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"></textarea>
    <button id="send">发送</button>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const permBar = document.getElementById('permission-bar');
const permToolEl = document.getElementById('perm-tool');
const permArgsEl = document.getElementById('perm-args');
let isRunning = false;
let currentPermissionId = null;

function addMsg(content, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = content;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return d;
}

function addSystem(text) {
  addMsg(text, 'system');
}

function send() {
  const text = inputEl.value.trim();
  if (!text || isRunning) return;
  addMsg(text, 'user');
  vscode.postMessage({ type: 'sendMessage', content: text });
  inputEl.value = '';
  isRunning = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '...';
}

function replyPermission(action) {
  if (currentPermissionId) {
    vscode.postMessage({ type: 'permissionReply', id: currentPermissionId, action });
    permBar.style.display = 'none';
    currentPermissionId = null;
  }
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
document.getElementById('perm-allow').addEventListener('click', () => replyPermission('allow'));
document.getElementById('perm-always').addEventListener('click', () => replyPermission('always_allow'));
document.getElementById('perm-deny').addEventListener('click', () => replyPermission('deny'));

window.addEventListener('message', e => {
  const m = e.data;
  switch (m.type) {
    case 'userMessage':
      addMsg(m.content, 'user');
      vscode.postMessage({ type: 'sendMessage', content: m.content });
      break;
    case 'agentStart':
      addSystem('Agent 启动中...');
      break;
    case 'agentThinking':
      addMsg(m.content || '...', 'assistant');
      break;
    case 'agentToolCall':
      addMsg('\\u{1F527} ' + m.tool + ' ' + JSON.stringify(m.args).slice(0, 200), 'tool_call');
      break;
    case 'agentToolResult':
      addMsg((m.result || '').slice(0, 800), 'tool_result');
      break;
    case 'agentResponse':
      addMsg(m.content, 'assistant');
      break;
    case 'agentError':
      addMsg('\\u2717 ' + m.error, 'error');
      break;
    case 'agentDone':
      addSystem('\\u2713 完成 (' + m.steps + ' 步)');
      isRunning = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      break;
    case 'agentEnd':
      break;
    case 'permissionAsk':
      currentPermissionId = m.id;
      permToolEl.textContent = '\\u26A0\\uFE0F ' + m.tool;
      permArgsEl.textContent = m.args;
      permBar.style.display = 'block';
      break;
    case 'fileChanged':
      addSystem('\\u{1F4C4} 文件已修改: ' + m.filePath);
      break;
  }
});
</script>
</body>
</html>`;
  }

  private dispose() {
    this.abortAgent();
    this.agentService.dispose();
    ChatPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
