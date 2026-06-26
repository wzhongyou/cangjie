import type { SlashCommand } from '../registry.js';

export const memoryCommand: SlashCommand = {
  name: 'memory',
  description: '查看项目记忆',
  execute(ctx) {
    const mem = ctx.loadMemory();
    if (mem) {
      ctx.print('');
      ctx.print(`项目记忆 (.cangjie/memory/):\n`);
      ctx.print(mem);
    } else {
      ctx.print('');
      ctx.print('暂无项目记忆。');
      ctx.print('创建: mkdir -p .cangjie/memory && echo "内容" > .cangjie/memory/xxx.md');
    }
  },
};
