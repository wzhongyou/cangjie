import { spawn, type ChildProcess } from 'node:child_process';
import type { ToolDefinition } from '@cangjie/shared';
import { toolLog } from './logger.js';

export interface McpServerConfig { command: string; args?: string[]; env?: Record<string, string>; }

export class McpClient {
  private child: ChildProcess | null = null;
  private rid = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buf = '';
  tools: ToolDefinition[] = [];

  constructor(private cfg: McpServerConfig) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child = spawn(this.cfg.command, this.cfg.args ?? [], {
        stdio: ['pipe','pipe','pipe'], env: { ...process.env, ...this.cfg.env }
      });
      this.child.stdout?.on('data', (data: Buffer) => { this.buf += data.toString('utf-8'); this.flush(); });
      this.child.on('error', reject);
      setTimeout(async () => {
        try {
          await this.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cangjie', version: '0.2.0' } });
          const tr = await this.send('tools/list', {});
          const list = (tr as any)?.tools ?? [];
          this.tools = list.map((t: any) => ({
            name: 'mcp__' + t.name, description: t.description ?? '',
            parameters: t.inputSchema ?? { type: 'object', properties: {} }
          }));
          toolLog.info({ server: this.cfg.command, count: this.tools.length }, 'MCP connected');
          resolve();
        } catch (err: any) { reject(err); }
      }, 500);
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const real = name.replace(/^mcp__/, '');
    const result = await this.send('tools/call', { name: real, arguments: args });
    const content = (result as any)?.content;
    return Array.isArray(content) ? content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n') : JSON.stringify(result);
  }

  disconnect(): void { this.child?.kill(); this.child = null; }

  private async send(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.rid;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('MCP timeout: ' + method)); }, 30000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  private flush(): void {
    const lines = this.buf.split('\n'); this.buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line); const p = this.pending.get(r.id);
        if (p) { this.pending.delete(r.id); r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result); }
      } catch {/* skip */}
    }
  }
}
