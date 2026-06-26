import type { SlashCommand } from '../registry.js';

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: '清屏',
  execute(ctx) {
    // Ink 环境下清屏交给终端处理，这里输出足够多的空行
    ctx.print('\n'.repeat(50));
  },
};
