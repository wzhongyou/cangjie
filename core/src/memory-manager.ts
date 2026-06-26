/**
 * MemoryManager — 四层记忆管理
 *
 * User Memory    (~/.cangjie/memory/)      手动维护，长期有效，全量注入 system prompt
 * Project Memory (.cangjie/memory/)        团队共享，版本控制，全量注入 system prompt
 * Session Memory (内存)                    当前对话的消息历史，会话后可提取关键结论
 * Agent Memory   (~/.cangjie/memories/)    Agent 自动生成，跨会话积累，按关键词 grep 检索
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GLOBAL_DIR, ensureDir, memoryDir } from './storage.js';

// ============================================================
// Memory 类型
// ============================================================

export type MemoryType = 'user' | 'project' | 'session' | 'agent';
export type MemoryStatus = 'active' | 'archived' | 'superseded';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  source: 'manual' | 'agent-generated';
  content: {
    title: string;
    body: string;
    tags: string[];
  };
  context?: {
    files?: string[];
    tools?: string[];
    keywords?: string[];
  };
  meta: {
    createdAt: string;
    updatedAt: string;
    sourceSessionId?: string;
    importance: number; // 1-5
  };
  status: MemoryStatus;
}

// ============================================================
// 路径
// ============================================================

const AGENT_MEMORY_DIR = path.join(GLOBAL_DIR, 'memories');

export function ensureMemoryDirs(workspace: string): void {
  ensureDir(memoryDir(workspace));
  ensureDir(path.join(GLOBAL_DIR, 'memory'));
  ensureDir(AGENT_MEMORY_DIR);
}

// ============================================================
// 读取
// ============================================================

/** 读取所有 Project Memory（全量注入 system prompt） */
export function loadProjectMemories(workspace: string): MemoryEntry[] {
  return readMarkdownFiles(memoryDir(workspace), 'project', 'manual');
}

/** 读取所有 User Memory（全量注入 system prompt） */
export function loadUserMemories(): MemoryEntry[] {
  return readMarkdownFiles(path.join(GLOBAL_DIR, 'memory'), 'user', 'manual');
}

/** 按关键词搜索 Agent Memory（按需加载，不全量注入） */
export function searchAgentMemories(keywords: string[]): MemoryEntry[] {
  const all = readMarkdownFiles(AGENT_MEMORY_DIR, 'agent', 'agent-generated');
  if (!keywords.length) return [];

  return all.filter((m) => {
    const searchText = [
      m.content.title,
      m.content.body,
      ...m.content.tags,
      ...(m.context?.keywords ?? []),
    ].join(' ').toLowerCase();

    return keywords.some((kw) => searchText.includes(kw.toLowerCase()));
  });
}

// ============================================================
// 写入
// ============================================================

/** 保存 Agent Memory（Agent 自动生成） */
export function saveAgentMemory(entry: Omit<MemoryEntry, 'id'>): string {
  ensureDir(AGENT_MEMORY_DIR);
  const id = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const full: MemoryEntry = { ...entry, id };

  const content = formatMemoryMarkdown(full);
  fs.writeFileSync(path.join(AGENT_MEMORY_DIR, `${id}.md`), content, 'utf-8');

  return id;
}

/** 归档过期记忆（>90天未命中） */
export function archiveStaleMemories(maxAgeDays = 90): number {
  ensureDir(AGENT_MEMORY_DIR);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let archived = 0;

  try {
    const files = fs.readdirSync(AGENT_MEMORY_DIR).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const filepath = path.join(AGENT_MEMORY_DIR, f);
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < cutoff) {
        const content = fs.readFileSync(filepath, 'utf-8');
        const updated = content.replace(/^status: active$/m, 'status: archived');
        fs.writeFileSync(filepath, updated, 'utf-8');
        archived++;
      }
    }
  } catch {
    // dir doesn't exist yet
  }

  return archived;
}

// ============================================================
// 格式转换
// ============================================================

function readMarkdownFiles(dir: string, type: MemoryType, source: 'manual' | 'agent-generated'): MemoryEntry[] {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    return files.map((f) => parseMemoryMarkdown(path.join(dir, f), type, source)).filter(Boolean) as MemoryEntry[];
  } catch {
    return [];
  }
}

function parseMemoryMarkdown(filepath: string, type: MemoryType, source: 'manual' | 'agent-generated'): MemoryEntry | null {
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    const name = path.basename(filepath, '.md');

    // Parse frontmatter-style metadata
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? name;
    const body = raw.replace(/^#\s+.+\n?/, '').trim();

    // Tags from markdown
    const tagsMatch = raw.match(/^tags:\s*(.+)$/m);
    const tags = tagsMatch ? tagsMatch[1].split(/[, ]+/).filter(Boolean) : [];

    const importanceMatch = raw.match(/^importance:\s*(\d)$/m);
    const importance = importanceMatch ? Number.parseInt(importanceMatch[1], 10) : 3;

    const statusMatch = raw.match(/^status:\s*(.+)$/m);
    const status = (statusMatch?.[1] ?? 'active') as MemoryStatus;

    const stat = fs.statSync(filepath);

    return {
      id: name,
      type,
      source,
      content: { title, body, tags },
      meta: {
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        importance: Math.min(5, Math.max(1, importance)),
      },
      status,
    };
  } catch {
    return null;
  }
}

function formatMemoryMarkdown(entry: MemoryEntry): string {
  const lines: string[] = [];
  lines.push(`# ${entry.content.title}`);
  lines.push('');
  lines.push(`tags: ${entry.content.tags.join(', ')}`);
  lines.push(`importance: ${entry.meta.importance}`);
  lines.push(`status: ${entry.status}`);
  if (entry.meta.sourceSessionId) lines.push(`source_session: ${entry.meta.sourceSessionId}`);
  if (entry.context?.keywords?.length) lines.push(`keywords: ${entry.context.keywords.join(', ')}`);
  lines.push('');
  lines.push(entry.content.body);
  return lines.join('\n');
}
