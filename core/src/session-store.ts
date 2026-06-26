/**
 * 会话持久化存储 — SQLite 实现
 *
 * 替代旧的全量 JSON 文件读写，支持：
 *  - 增量消息写入
 *  - 检查点（Checkpoint）
 *  - 会话统计
 *  - 权限决策审计
 */
import Database from 'better-sqlite3';
import * as path from 'node:path';
import type { Message } from '@cangjie/shared';
import { ensureDir, GLOBAL_DIR } from './storage.js';

const DB_PATH = path.join(GLOBAL_DIR, 'sessions.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    ensureDir(GLOBAL_DIR);
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_call_id TEXT,
      token_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, step);

    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      message_index INTEGER NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      tool TEXT NOT NULL,
      args TEXT,
      decision TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_stats (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      total_steps INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      tool_calls_json TEXT DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `);
}

// ============================================================
// 会话 CRUD
// ============================================================

export interface SessionRow {
  id: string;
  workspace: string;
  model: string;
  provider: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function createSession(session: SessionRow): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO sessions (id, workspace, model, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(session.id, session.workspace, session.model, session.provider, session.status, session.createdAt, session.updatedAt);
}

export function updateSession(id: string, updates: Partial<Pick<SessionRow, 'status' | 'updatedAt'>>): void {
  const d = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.status) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.updatedAt) { sets.push('updated_at = ?'); vals.push(updates.updatedAt); }
  if (sets.length === 0) return;
  vals.push(id);
  d.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getSession(id: string): SessionRow | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    workspace: row.workspace,
    model: row.model,
    provider: row.provider,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSessionsFromDb(limit = 10): SessionRow[] {
  const d = getDb();
  const rows = d.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as any[];
  return rows.map((row) => ({
    id: row.id,
    workspace: row.workspace,
    model: row.model,
    provider: row.provider,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ============================================================
// 消息存储
// ============================================================

export function appendMessage(sessionId: string, step: number, msg: Message): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO messages (session_id, step, role, content, tool_calls, tool_call_id, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    step,
    msg.role,
    msg.content,
    msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
    msg.toolCallId ?? null,
    estimateTokenCount(msg.content),
    new Date().toISOString(),
  );
}

export function getMessages(sessionId: string, limit?: number): Message[] {
  const d = getDb();
  const query = limit
    ? 'SELECT * FROM messages WHERE session_id = ? ORDER BY step, id LIMIT ?'
    : 'SELECT * FROM messages WHERE session_id = ? ORDER BY step, id';
  const rows = d.prepare(query).all(sessionId, ...(limit ? [limit] : [])) as any[];
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id ?? undefined,
  }));
}

// ============================================================
// 检查点
// ============================================================

export interface CheckpointRow {
  id: number;
  sessionId: string;
  step: number;
  messageIndex: number;
  summary: string | null;
  createdAt: string;
}

export function saveCheckpoint(sessionId: string, step: number, messageIndex: number, summary?: string): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO checkpoints (session_id, step, message_index, summary, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, step, messageIndex, summary ?? null, new Date().toISOString());
}

export function getLastCheckpoint(sessionId: string): CheckpointRow | null {
  const d = getDb();
  const row = d.prepare(
    'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY step DESC LIMIT 1',
  ).get(sessionId) as any;
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    step: row.step,
    messageIndex: row.message_index,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

// ============================================================
// 权限决策审计
// ============================================================

export function recordDecision(
  sessionId: string,
  step: number,
  tool: string,
  args: Record<string, unknown>,
  decision: string,
  reason?: string,
): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO decisions (session_id, step, tool, args, decision, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, step, tool, JSON.stringify(args), decision, reason ?? null, new Date().toISOString());
}

// ============================================================
// 统计
// ============================================================

export function updateStats(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  toolName?: string,
): void {
  const d = getDb();
  // Upsert stats row
  const existing = d.prepare('SELECT * FROM session_stats WHERE session_id = ?').get(sessionId) as any;

  if (existing) {
    const toolCalls = JSON.parse(existing.tool_calls_json || '{}');
    if (toolName) toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;

    d.prepare(
      `UPDATE session_stats SET
         total_steps = total_steps + 1,
         total_input_tokens = total_input_tokens + ?,
         total_output_tokens = total_output_tokens + ?,
         total_duration_ms = total_duration_ms + ?,
         tool_calls_json = ?,
         updated_at = ?
       WHERE session_id = ?`,
    ).run(inputTokens, outputTokens, durationMs, JSON.stringify(toolCalls), new Date().toISOString(), sessionId);
  } else {
    const toolCalls: Record<string, number> = {};
    if (toolName) toolCalls[toolName] = 1;

    d.prepare(
      `INSERT INTO session_stats (session_id, total_steps, total_input_tokens, total_output_tokens, total_duration_ms, tool_calls_json, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
    ).run(sessionId, inputTokens, outputTokens, durationMs, JSON.stringify(toolCalls), new Date().toISOString());
  }
}

export interface SessionStatsRow {
  sessionId: string;
  totalSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  toolCalls: Record<string, number>;
}

export function getStats(sessionId: string): SessionStatsRow | null {
  const d = getDb();
  const row = d.prepare('SELECT * FROM session_stats WHERE session_id = ?').get(sessionId) as any;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    totalSteps: row.total_steps,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalDurationMs: row.total_duration_ms,
    toolCalls: JSON.parse(row.tool_calls_json || '{}'),
  };
}

// ============================================================
// 工具
// ============================================================

function estimateTokenCount(text: string): number {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
