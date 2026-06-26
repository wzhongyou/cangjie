import * as fs from 'node:fs';
import * as path from 'node:path';
import { GLOBAL_DIR } from './storage.js';

export interface Skill {
  name: string;
  description: string;
  content: string;
  keywords: string[];
  source: 'project' | 'user';
}

const cache = new Map<string, Skill[]>();

export function discoverSkills(workspace: string): Skill[] {
  if (cache.has(workspace)) return cache.get(workspace)!;
  const skills: Skill[] = [];
  const pd = path.join(workspace, '.cangjie', 'skills');
  skills.push(...loadDir(pd, 'project'));
  const ud = path.join(GLOBAL_DIR, 'skills');
  skills.push(...loadDir(ud, 'user'));
  cache.set(workspace, skills);
  return skills;
}

function loadDir(dir: string, source: Skill['source']): Skill[] {
  const skills: Skill[] = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sp = path.join(dir, e.name, 'SKILL.md');
      try {
        const raw = fs.readFileSync(sp, 'utf-8');
        const dm = raw.match(/^description:\s*(.+)$/m);
        const km = raw.match(/^keywords:\s*(.+)$/m);
        const bm = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        const c = bm ? bm[1].trim() : raw;
        if (!c.trim()) continue;
        skills.push({
          name: e.name, description: dm?.[1] ?? e.name, content: c,
          keywords: km ? km[1].split(/[, ]+/).filter(Boolean) : [], source
        });
      } catch { /* skip */ }
    }
  } catch { /* dir missing */ }
  return skills;
}
