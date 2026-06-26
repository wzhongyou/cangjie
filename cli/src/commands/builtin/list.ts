import type { SlashCommand } from '../registry.js';

export const listCommand: SlashCommand = {
  name: 'list',
  description: '查看历史会话',
  execute(ctx) {
    const sessions = ctx.listSessions();
    if (sessions.length === 0) {
      ctx.print('没有历史会话。');
      return;
    }
    ctx.print('');
    ctx.print('历史会话:\n');
    for (const s of sessions.slice(0, 5)) {
      ctx.print(`  ${s}`);
    }
    ctx.print('');
    ctx.print('恢复: cj --resume <id>');
  },
};
