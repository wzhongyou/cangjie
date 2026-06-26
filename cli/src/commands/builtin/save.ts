import type { SlashCommand } from '../registry.js';

export const saveCommand: SlashCommand = {
  name: 'save',
  description: '手动保存当前会话',
  execute(ctx) {
    ctx.saveSession();
    ctx.print('✅ 会话已保存');
  },
};
