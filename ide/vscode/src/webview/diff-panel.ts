/**
 * Diff Review Panel
 *
 * Agent 任务完成后展示文件变更的 Diff 审查面板。
 * 用户可逐文件 Accept / Reject。
 */

import * as vscode from 'vscode';

export interface FileChange {
  filePath: string;
  preContent: string;
  postContent: string;
}

/** 简单的行级 diff */
function computeDiff(pre: string, post: string): Array<{ type: 'same' | 'added' | 'removed'; text: string }> {
  const preLines = pre.split('\n');
  const postLines = post.split('\n');
  const result: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = [];

  // 简单 LCS-based diff (足够 v0.1)
  const maxLen = Math.max(preLines.length, postLines.length);
  let i = 0,
    j = 0;

  while (i < preLines.length && j < postLines.length) {
    if (preLines[i] === postLines[j]) {
      result.push({ type: 'same', text: preLines[i] });
      i++;
      j++;
    } else {
      // 向前看 3 行找匹配
      let found = false;
      for (let look = 1; look <= 3 && i + look < preLines.length; look++) {
        if (preLines[i + look] === postLines[j]) {
          // 当前行是被删除的
          for (let k = 0; k < look; k++) {
            result.push({ type: 'removed', text: preLines[i + k] });
          }
          i += look;
          found = true;
          break;
        }
      }
      if (!found) {
        for (let look = 1; look <= 3 && j + look < postLines.length; look++) {
          if (preLines[i] === postLines[j + look]) {
            for (let k = 0; k < look; k++) {
              result.push({ type: 'added', text: postLines[j + k] });
            }
            j += look;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        // 视为替换
        result.push({ type: 'removed', text: preLines[i] });
        result.push({ type: 'added', text: postLines[j] });
        i++;
        j++;
      }
    }
  }

  // 剩余
  while (i < preLines.length) result.push({ type: 'removed', text: preLines[i++] });
  while (j < postLines.length) result.push({ type: 'added', text: postLines[j++] });

  return result;
}

export class DiffPanel {
  public static currentPanel: DiffPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly changes: FileChange[];
  private readonly onAcceptAll: (() => void) | null;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, changes: FileChange[], onAcceptAll?: () => void) {
    this.panel = panel;
    this.changes = changes;
    this.onAcceptAll = onAcceptAll ?? null;

    this.panel.webview.html = this.getHtml(panel.webview, changes);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        switch (msg.type) {
          case 'accept':
            // 文件已保留（不做任何事）
            this.postToWebview({ type: 'accepted', index: msg.index });
            break;
          case 'reject':
            this.rejectChange(msg.index);
            break;
          case 'acceptAll':
            // 全部确认，关闭面板
            this.onAcceptAll?.();
            this.dispose();
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  static createOrShow(context: vscode.ExtensionContext, changes: FileChange[], onAcceptAll?: () => void): DiffPanel {
    if (DiffPanel.currentPanel) {
      DiffPanel.currentPanel.dispose();
    }

    const panel = vscode.window.createWebviewPanel('cangjieDiff', 'Cangjie Diff Review', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    DiffPanel.currentPanel = new DiffPanel(panel, changes, onAcceptAll);
    return DiffPanel.currentPanel;
  }

  /** 撤销某个文件的修改 */
  private rejectChange(index: number) {
    const change = this.changes[index];
    if (!change) return;

    try {
      const fs = require('node:fs');
      fs.writeFileSync(change.filePath, change.preContent, 'utf-8');
      this.postToWebview({ type: 'rejected', index });
      vscode.window.showInformationMessage(`已还原: ${change.filePath}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`还原失败: ${err.message}`);
    }
  }

  private postToWebview(msg: Record<string, unknown>) {
    this.panel.webview.postMessage(msg);
  }

  private dispose() {
    DiffPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private getHtml(webview: vscode.Webview, changes: FileChange[]): string {
    const csp = webview.cspSource;
    const diffs = changes.map((c, i) => {
      const d = computeDiff(c.preContent, c.postContent);
      return { index: i, filePath: c.filePath, diff: d };
    });

    const diffHtml = diffs
      .map(
        (d) => `
      <div class="file-section" id="file-${d.index}">
        <div class="file-header">
          <span class="file-path">📄 ${d.filePath}</span>
          <div class="file-btns">
            <button class="btn accept" onclick="accept(${d.index})">✓ Accept</button>
            <button class="btn reject" onclick="reject(${d.index})">✗ Reject</button>
          </div>
        </div>
        <div class="diff-content">
          ${d.diff
            .map((line) => {
              const cls = line.type === 'added' ? 'added' : line.type === 'removed' ? 'removed' : 'same';
              const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
              const escaped = line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              return `<div class="diff-line ${cls}"><span class="prefix">${prefix}</span>${escaped}</div>`;
            })
            .join('')}
        </div>
      </div>
    `,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline';">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,monospace;font-size:12px;color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:12px}
    h2{font-size:14px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--vscode-panel-border)}
    .toolbar{margin-bottom:12px}
    .toolbar .btn{padding:6px 16px;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin-right:8px}
    .toolbar .btn.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    .toolbar .btn.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
    .file-section{margin-bottom:16px;border:1px solid var(--vscode-panel-border);border-radius:6px;overflow:hidden}
    .file-header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border)}
    .file-path{font-weight:bold;font-size:13px}
    .file-btns{display:flex;gap:6px}
    .file-btns .btn{padding:3px 10px;border:none;border-radius:3px;cursor:pointer;font-size:11px}
    .btn.accept{background:#28a745;color:white}
    .btn.reject{background:#dc3545;color:white}
    .btn.accepted{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:default}
    .diff-content{overflow-x:auto}
    .diff-line{padding:1px 8px;white-space:pre;font-size:11px;line-height:1.5}
    .diff-line.added{background:rgba(40,167,69,0.15);color:#28a745}
    .diff-line.removed{background:rgba(220,53,69,0.15);color:#dc3545}
    .diff-line.same{color:var(--vscode-descriptionForeground)}
    .prefix{margin-right:8px;user-select:none;opacity:0.6}
  </style>
</head>
<body>
  <h2>Cangjie Diff Review — ${changes.length} 个文件已修改</h2>
  <div class="toolbar">
    <button class="btn primary" onclick="acceptAll()">全部 Accept</button>
  </div>
  ${diffHtml}

<script>
const vscode = acquireVsCodeApi();

function accept(i) {
  vscode.postMessage({ type: 'accept', index: i });
  const el = document.getElementById('file-' + i);
  if (el) {
    el.querySelector('.file-header').style.opacity = '0.5';
    const acceptBtn = el.querySelector('.btn.accept');
    if (acceptBtn) { acceptBtn.className = 'btn accepted'; acceptBtn.textContent = '✓ Accepted'; acceptBtn.onclick = null; }
    const rejectBtn = el.querySelector('.btn.reject');
    if (rejectBtn) rejectBtn.style.display = 'none';
  }
}

function reject(i) {
  vscode.postMessage({ type: 'reject', index: i });
  const el = document.getElementById('file-' + i);
  if (el) {
    el.querySelector('.file-header').style.opacity = '0.5';
    const rejectBtn = el.querySelector('.btn.reject');
    if (rejectBtn) { rejectBtn.className = 'btn accepted'; rejectBtn.textContent = '✗ Rejected'; rejectBtn.onclick = null; }
    const acceptBtn = el.querySelector('.btn.accept');
    if (acceptBtn) acceptBtn.style.display = 'none';
  }
}

function acceptAll() {
  vscode.postMessage({ type: 'acceptAll' });
}

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'accepted' || m.type === 'rejected') {
    const el = document.getElementById('file-' + m.index);
    if (el) el.style.opacity = '0.6';
  }
});
</script>
</body>
</html>`;
  }
}
