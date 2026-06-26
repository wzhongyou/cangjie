import type { SlashCommand } from '../registry.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  description: '显示帮助',
  execute(ctx) {
    const lines = [
      '',
      '命令列表:',
      '',
      '  /help           显示帮助',
      '  /save           保存当前会话',
      '  /list           查看历史会话',
      '  /memory         查看项目记忆',
      '  /clear          清屏',
      '  /exit, /q       退出',
      '',
      '快捷键:',
      '  Enter           发送消息',
      '  Ctrl+C          中断 Agent 执行',
      '  Ctrl+R          搜索输入历史',
      '  ↑↓              浏览输入历史',
      '  Esc             清空输入',
      '',
    ];
    for (const line of lines) {
      ctx.print(line);
    }
  },
};
