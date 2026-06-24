/**
 * 持久化存储：~/.cangjie + 项目级 .cangjie
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from '@cangjie/shared';

// ============================================================
// 路径
// ============================================================

export const GLOBAL_DIR = path.join(os.homedir(), '.cangjie');
export const SESSIONS_DIR = path.join(GLOBAL_DIR, 'sessions');
export const CONFIG_PATH = path.join(GLOBAL_DIR, 'config.json');

export function projectDir(workspace: string): string {
  return path.join(workspace, '.cangjie');
}

export function memoryDir(workspace: string): string {
  return path.join(projectDir(workspace), 'memory');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// 会话
// ============================================================

export interface SessionMeta {
  id: string;
  workspace: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface SessionData {
  meta: SessionMeta;
  messages: Message[];
}

export function sessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

export function sessionPath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function saveSession(session: SessionData): void {
  ensureDir(SESSIONS_DIR);
  fs.writeFileSync(sessionPath(session.meta.id), JSON.stringify(session, null, 2), 'utf-8');
}

export function loadSession(id: string): SessionData | null {
  try {
    const raw = fs.readFileSync(sessionPath(id), 'utf-8');
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function listSessions(limit = 10): SessionMeta[] {
  try {
    ensureDir(SESSIONS_DIR);
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    const metas: SessionMeta[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
        const data = JSON.parse(raw) as SessionData;
        metas.push(data.meta);
      } catch {
        // skip corrupted
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  } catch {
    return [];
  }
}

// ============================================================
// Memory 文件读取
// ============================================================

export function loadProjectMemory(workspace: string): string {
  const dir = memoryDir(workspace);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    return files
      .map((f) => {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        return `## ${f}\n\n${content}`;
      })
      .join('\n\n---\n\n');
  } catch {
    return '';
  }
}

// ============================================================
// 用户配置
// ============================================================

export interface UserConfig {
  model?: string;
  autoYes?: boolean;
}

export function loadUserConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveUserConfig(config: UserConfig): void {
  ensureDir(GLOBAL_DIR);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
