import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { agentLog } from './logger.js';

export type HookEvent = 'tool.execute.before' | 'tool.execute.after' | 'session.created' | 'file.changed';

export interface HookContext {
  event: HookEvent; workspaceRoot: string;
  tool?: string; args?: Record<string, unknown>; result?: string;
  sessionId?: string; filePath?: string;
}

class HookRunner {
  private dir: string | null = null;

  loadFromWorkspace(workspace: string): void {
    const d = path.join(workspace, '.cangjie', 'hooks');
    if (fs.existsSync(d)) { this.dir = d; agentLog.info({ hooksDir: d }, 'Hooks loaded'); }
  }

  async trigger(event: HookEvent, ctx: HookContext): Promise<boolean> {
    if (!this.dir) return true;
    const ed = path.join(this.dir, event);
    if (!fs.existsSync(ed)) return true;
    const scripts = fs.readdirSync(ed)
      .filter((f: string) => ['.sh','.js','.ts','.mjs',''].includes(path.extname(f)))
      .sort();
    for (const s of scripts) {
      const sp = path.join(ed, s);
      try {
        const ok = await new Promise<boolean>((resolve) => {
          const c = spawn(sp, [], {
            cwd: ctx.workspaceRoot, stdio: ['pipe','pipe','pipe'],
            env: { ...process.env, CANGJIE_EVENT: ctx.event, CANGJIE_TOOL: ctx.tool ?? '', CANGJIE_SESSION: ctx.sessionId ?? '', CANGJIE_FILE: ctx.filePath ?? '' },
            timeout: 10000,
          });
          c.on('close', (code: number | null) => resolve(code !== 2));
          c.on('error', () => resolve(true));
        });
        if (!ok) { agentLog.warn({ event, script: s }, 'Hook blocked'); return false; }
      } catch (err: any) { agentLog.warn({ event, script: s, error: err.message }, 'Hook error'); }
    }
    return true;
  }
}

export const hooks = new HookRunner();
