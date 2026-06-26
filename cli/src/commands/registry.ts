/**
 * CommandRegistry — 斜杠命令注册系统
 *
 * 用法：
 *   const registry = new CommandRegistry();
 *   registry.register({ name: 'help', description: '显示帮助', execute: ... });
 *   registry.execute('help', ctx);
 */
export interface CommandContext {
  /** 向终端输出文字 */
  print: (text: string) => void;
  /** 当前工作区 */
  workspace: string;
  /** 保存当前会话 */
  saveSession: () => void;
  /** 列出历史会话 */
  listSessions: () => string[];
  /** 加载项目记忆 */
  loadMemory: () => string;
  /** 退出应用 */
  exit: () => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  execute: (ctx: CommandContext) => void | Promise<void>;
}

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();

  register(command: SlashCommand): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command already registered: /${command.name}`);
    }
    this.commands.set(command.name, command);
  }

  execute(name: string, ctx: CommandContext): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) return false;
    cmd.execute(ctx);
    return true;
  }

  list(): SlashCommand[] {
    return Array.from(this.commands.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }
}
