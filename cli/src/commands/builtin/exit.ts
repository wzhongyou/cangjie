import type { SlashCommand } from '../registry.js';

export const exitCommand: SlashCommand = {
  name: 'exit',
  description: '退出',
  execute(ctx) {
    ctx.saveSession();
    ctx.print('再见 👋');
    ctx.exit();
  },
};
