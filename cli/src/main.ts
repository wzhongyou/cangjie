#!/usr/bin/env node
/**
 * Cangjie CLI
 *
 * 用法:
 *   cj "在项目里搜 login 相关代码"
 *   cj --yes "重构 user.ts"
 *   cj                    # 交互模式
 *   cj --list             # 列出历史会话
 *   cj --resume <id>      # 恢复会话
 */

import * as readline from 'node:readline';
import type { SessionData } from '@cangjie/core';
import {
  CangjieAgent,
  createLlmClient,
  listSessions,
  loadProjectMemory,
  loadSession,
  saveSession,
  sessionId,
  ToolRegistry,
} from '@cangjie/core';
import type { AgentEvent, Message } from '@cangjie/shared';

function printUsage(): void {
  console.log(`Cangjie CLI v0.1.0

用法:
  cj [选项] "<提示词>"
  cj [选项]                          # 进入交互模式

选项:
  --yes, -y         自动批准所有操作
  --workspace, -w   工作区目录（默认: 当前目录）
  --model, -m       模型名称
  --list            列出最近 10 个会话
  --resume <id>     恢复指定会话
  --help, -h        显示帮助
`);
}

function parseArgs(): {
  prompt: string;
  workspace: string;
  model: string;
  yes: boolean;
  list: boolean;
  resume: string;
} {
  const args = process.argv.slice(2);
  let workspace = process.cwd();
  let model = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6';
  let yes = false;
  let list = false;
  let resume = '';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--yes' || a === '-y') {
      yes = true;
    } else if (a === '--workspace' || a === '-w') {
      workspace = args[++i] ?? workspace;
    } else if (a === '--model' || a === '-m') {
      model = args[++i] ?? model;
    } else if (a === '--list') {
      list = true;
    } else if (a === '--resume') {
      resume = args[++i] ?? '';
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      positional.push(a);
    }
  }

  let prompt = positional.join(' ');
  if (!prompt && !process.stdin.isTTY) {
    prompt = '';
  }

  return { prompt, workspace, model, yes, list, resume };
}

// 权限确认（复用 REPL readline，避免 stdin 冲突）
async function askUser(question: string, rl?: readline.Interface): Promise<boolean> {
  if (!rl) {
    // 非 REPL 模式，创建临时 readline
    const tmp = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
      tmp.question(`\x1b[33m${question}\x1b[0m [y/N] `, (answer) => {
        tmp.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  // REPL 模式，用同一个 readline
  return new Promise((resolve) => {
    rl.question(`\x1b[33m${question}\x1b[0m [y/N] `, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function renderEvent(event: AgentEvent) {
  switch (event.type) {
    case 'thinking':
      process.stdout.write(`\x1b[90m${event.content}\x1b[0m`);
      break;
    case 'tool_call':
      process.stderr.write(`\n\x1b[36m🔧 ${event.tool}\x1b[0m ${JSON.stringify(event.args).slice(0, 200)}\n`);
      break;
    case 'tool_result':
      process.stderr.write(`\x1b[90m${event.result.slice(0, 500)}\x1b[0m\n`);
      break;
    case 'response':
      process.stdout.write(`\n\x1b[32m${event.content}\x1b[0m\n`);
      break;
    case 'error':
      process.stderr.write(`\n\x1b[31m✗ ${event.error}\x1b[0m\n`);
      break;
    case 'done':
      process.stderr.write(`\n\x1b[90m✓ 完成 (${event.steps} 步)\x1b[0m\n`);
      break;
  }
}

function createAgent(opts: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  workspace: string;
  yes: boolean;
  sid: string;
  askRl?: readline.Interface;
}) {
  const { apiKey, model, baseUrl, workspace, yes, sid, askRl } = opts;

  const llm = createLlmClient({ provider: 'anthropic', apiKey, model, baseUrl });

  const tools = new ToolRegistry();

  const memoryContent = loadProjectMemory(workspace);
  const memoryPrompt = memoryContent ? `\n\n## Project Memory\n\n${memoryContent}` : '';

  const agent = new CangjieAgent(llm, tools, {
    config: {
      llm: { provider: 'anthropic', apiKey, model, maxTokens: 8192 },
      permissions: { autoAllowReadOnly: true, rules: [] },
      context: { maxHistoryTokens: 100000, compactionThreshold: 0.85 },
    },
    workspaceRoot: workspace,
    sessionId: sid,
    maxSteps: 50,
  });

  const originalCheck = (agent as any).permission.check.bind((agent as any).permission);
  (agent as any).permission.check = async (tool: string, args: Record<string, unknown>) => {
    const decision = await originalCheck(tool, args);
    if (decision.action === 'ask') {
      if (yes) return { action: 'allow' };
      const allowed = await askUser(`允许执行 ${tool}？`, askRl);
      return { action: allowed ? 'allow' : ('deny' as const), reason: allowed ? undefined : '用户拒绝' };
    }
    return decision;
  };

  return { agent, memoryPrompt };
}

// ============================================================
// --list
// ============================================================

async function handleList() {
  const sessions = listSessions(10);
  if (sessions.length === 0) {
    console.log('没有历史会话。');
    return;
  }
  console.log('\n最近会话:\n');
  for (const s of sessions) {
    const date = new Date(s.updatedAt).toLocaleString('zh-CN');
    console.log(`  \x1b[1m${s.id}\x1b[0m`);
    console.log(`  \x1b[90m${date}  |  ${s.model}  |  ${s.messageCount} 条消息  |  ${s.workspace}\x1b[0m\n`);
  }
  console.log(`恢复: \x1b[1mcj --resume <id>\x1b[0m`);
}

// ============================================================
// 单个 Agent 运行（一次 shot 或 REPL 中的一回合）
// ============================================================

async function runAgentTurn(
  agent: CangjieAgent,
  prompt: string,
  history?: Message[],
  signal?: AbortSignal,
  systemPrompt?: string,
): Promise<void> {
  for await (const event of agent.run({ prompt, history, systemPrompt }, signal)) {
    renderEvent(event);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { prompt: initialPrompt, workspace, model, yes, list, resume } = parseArgs();

  // --list
  if (list) {
    await handleList();
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    console.error('错误: 请设置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN 环境变量');
    process.exit(1);
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL;

  // 从 stdin 读入 prompt（管道模式）
  let prompt = initialPrompt;
  if (!prompt && !process.stdin.isTTY) {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) chunks.push(chunk as string);
    prompt = chunks.join('').trim();
  }

  console.log(`\n\x1b[1mCangjie\x1b[0m \x1b[90mv0.1.0\x1b[0m`);
  console.log(`\x1b[90m工作区: ${workspace}\x1b[0m`);
  console.log(`\x1b[90m模型: ${model}\x1b[0m`);

  // --resume
  let sid: string;
  let history: Message[] | undefined;

  if (resume) {
    const data = loadSession(resume);
    if (!data) {
      console.error(`会话不存在: ${resume}`);
      process.exit(1);
    }
    sid = data.meta.id;
    history = data.messages.filter((m) => m.role !== 'system');
    console.log(`\x1b[90m已恢复会话 ${sid}（${data.meta.messageCount} 条消息）\x1b[0m`);
  } else {
    sid = sessionId();
  }

  console.log(`\x1b[90m会话: ${sid}\x1b[0m\n`);

  // 一次性模式
  if (prompt) {
    const { agent, memoryPrompt } = createAgent({ apiKey, model, baseUrl, workspace, yes, sid, askRl: undefined });
    if (history?.length) {
      agent.lastMessages = [{ role: 'system', content: '' }, ...history];
    }
    const signal = new AbortController().signal;
    // 首次调用带 memory
    const firstSystem = memoryPrompt || undefined;
    await runAgentTurn(agent, prompt, history, signal, firstSystem);

    // 保存
    saveSession({
      meta: {
        id: sid,
        workspace,
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: agent.lastMessages.length,
      },
      messages: agent.lastMessages,
    });
    console.log();
    return;
  }

  // ---- 交互式 REPL 模式 ----
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[1mcj>\x1b[0m ',
  });

  const { agent, memoryPrompt } = createAgent({ apiKey, model, baseUrl, workspace, yes, sid, askRl: rl });
  if (history?.length) {
    agent.lastMessages = [{ role: 'system', content: '' }, ...history];
  }

  console.log('命令: /help 帮助  /exit 退出  /save 保存会话  /list 历史  /memory 查看记忆  Ctrl+C 中断\n');

  let abortController: AbortController | null = null;

  const saveCurrentSession = () => {
    const msgs = agent.lastMessages;
    if (!msgs.length) return;
    saveSession({
      meta: {
        id: sid,
        workspace,
        model,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: msgs.length,
      },
      messages: msgs,
    });
    process.stderr.write(`\x1b[90m已保存到 ~/.cangjie/sessions/${sid}.json\x1b[0m\n`);
  };

  const askLoop = () => {
    rl.prompt();
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }
      if (trimmed === '/exit' || trimmed === '/q') {
        saveCurrentSession();
        rl.close();
        return;
      }
      if (trimmed === '/save') {
        saveCurrentSession();
        rl.prompt();
        return;
      }
      if (trimmed === '/help') {
        console.log('\n命令列表:');
        console.log('  /exit, /q    退出（自动保存）');
        console.log('  /save        手动保存会话');
        console.log('  /list        查看最近会话');
        console.log('  /memory      查看项目记忆');
        console.log('  /help        显示帮助');
        console.log('  Ctrl+C       中断当前任务\n');
        rl.prompt();
        return;
      }
      if (trimmed === '/list') {
        const sessions = listSessions(5);
        if (sessions.length === 0) {
          console.log('没有历史会话。');
        } else {
          console.log();
          for (const s of sessions) {
            const date = new Date(s.updatedAt).toLocaleString('zh-CN');
            console.log(`  ${s.id}`);
            console.log(`  ${date}  |  ${s.model}  |  ${s.messageCount} 条  |  ${s.workspace}\n`);
          }
        }
        rl.prompt();
        return;
      }
      if (trimmed === '/memory') {
        const mem = loadProjectMemory(workspace);
        if (mem) {
          console.log(`\n项目记忆 (.cangjie/memory/):\n\n${mem}\n`);
        } else {
          console.log('\n暂无项目记忆。创建: mkdir -p .cangjie/memory && echo "内容" > .cangjie/memory/xxx.md\n');
        }
        rl.prompt();
        return;
      }

      abortController = new AbortController();
      const h = agent.lastMessages.filter((m) => m.role !== 'system');
      const isFirstTurn = h.length === 0;
      await runAgentTurn(
        agent,
        trimmed,
        h.length > 0 ? h : undefined,
        abortController.signal,
        isFirstTurn ? memoryPrompt : undefined,
      );

      // 每个回合自动保存
      if (agent.lastMessages.length > 0) {
        saveSession({
          meta: {
            id: sid,
            workspace,
            model,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messageCount: agent.lastMessages.length,
          },
          messages: agent.lastMessages,
        });
      }
      console.log();
      rl.prompt();
    });
  };

  process.on('SIGINT', () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
      process.stderr.write('\n\x1b[33m⏸ 已中断\x1b[0m\n');
      rl.prompt();
    } else {
      saveCurrentSession();
      rl.close();
    }
  });

  rl.on('close', () => {
    console.log('\n再见 👋');
    process.exit(0);
  });

  askLoop();
}

main().catch((err) => {
  console.error(`\n\x1b[31m致命错误: ${err.message}\x1b[0m`);
  process.exit(1);
});
