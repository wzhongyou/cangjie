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
  listAllSessions,
  listSessions,
  loadProjectConfig,
  loadProjectMemory,
  loadSession,
  loadUserConfig,
  resolveConfig,
  saveSession,
  sessionId,
  ToolRegistry,
} from '@cangjie/core';
import { hooks } from '@cangjie/core';
import { discoverSkills } from '@cangjie/core';
import { loadUserMemories, loadProjectMemories } from '@cangjie/core';
import { createResilientClient } from '@cangjie/core';
import type { AgentEvent, LlmProvider, Message } from '@cangjie/shared';

// TUI (Ink) — 仅在交互模式 + TTY 时使用
let InkApp: any = null;
let InkRender: any = null;
let TuiApp: any = null;
async function loadTui() {
  if (!TuiApp) {
    const [ink, appMod] = await Promise.all([
      import('ink'),
      import('./tui/app.js'),
    ]);
    InkRender = ink.render;
    TuiApp = appMod.App;
  }
  return { render: InkRender, App: TuiApp };
}

function printUsage(): void {
  console.log(`Cangjie CLI v0.2.0

用法:
  cj [选项] "<提示词>"
  cj [选项]                          # 进入交互模式

选项:
  --yes, -y         自动批准所有操作
  --workspace, -w   工作区目录（默认: 当前目录）
  --model, -m       模型名称
  --provider, -p    LLM 提供商: anthropic | openai | openai-compat（默认: anthropic）
  --base-url        OpenAI-compat 的 API 地址（如 http://localhost:11434）
  --list            列出最近 10 个会话
  --resume <id>     恢复指定会话
  --help, -h        显示帮助
`);
}

function parseArgs(): {
  prompt: string;
  workspace: string;
  model: string;
  provider: string;
  baseUrl: string;
  yes: boolean;
  list: boolean;
  resume: string;
} {
  const args = process.argv.slice(2);
  let workspace = process.cwd();
  let model = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-6';
  let provider = 'anthropic';
  let baseUrl = '';
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
    } else if (a === '--provider' || a === '-p') {
      provider = args[++i] ?? provider;
    } else if (a === '--base-url') {
      baseUrl = args[++i] ?? '';
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

  return { prompt, workspace, model, provider, baseUrl, yes, list, resume };
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
    case 'plan':
      process.stderr.write(`\n\x1b[35m📋 任务计划:\x1b[0m\n`);
      for (const t of event.todos) {
        const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
        process.stderr.write(`  ${icon} ${t.content}\n`);
      }
      break;
    case 'compact':
      process.stderr.write(`\n\x1b[33m📦 上下文压缩: ${event.reason}\x1b[0m\n`);
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
  provider: string;
  baseUrl?: string;
  workspace: string;
  yes: boolean;
  sid: string;
  askRl?: readline.Interface;
}) {
  const { apiKey, model, provider, baseUrl, workspace, yes, sid, askRl } = opts;

  // Resilient client with retry + fallback
  const { client: llm } = createResilientClient(
    { provider: provider as LlmProvider, apiKey, model, baseUrl },
    { maxRetries: 3, retryBaseMs: 1000 }
  );

  const tools = new ToolRegistry();

  // Load hooks from workspace
  hooks.loadFromWorkspace(workspace);

  // Build rich system prompt with memory + skills
  const memoryContent = loadProjectMemory(workspace);
  const userMemories = loadUserMemories();
  const projectMemories = loadProjectMemories(workspace);
  const skills = discoverSkills(workspace);
  const parts: string[] = [];
  if (memoryContent) parts.push('## Project Memory\\n\\n' + memoryContent);
  if (userMemories.length) parts.push('## User Memory\\n\\n' + userMemories.map((m: any) => m.content.body).join('\\n\\n'));
  if (projectMemories.length) parts.push('## Project Memory\\n\\n' + projectMemories.map((m: any) => m.content.body).join('\\n\\n'));
  if (skills.length) parts.push('## Available Skills\\n\\n' + skills.map((s: any) => '- ' + s.name + ': ' + s.description).join('\\n'));
  const memoryPrompt = parts.join('\\n\\n---\\n\\n');

  const agent = new CangjieAgent(llm, tools, {
    config: {
      llm: { provider, apiKey, model, maxTokens: 8192 },
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
  const sessions = listAllSessions(10);
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
// TUI 模式入口（Ink）
// ============================================================

async function startTui(opts: {
  agent: CangjieAgent;
  provider: string;
  model: string;
  workspace: string;
  memoryPrompt: string;
  sid: string;
}) {
  const { render, App } = await loadTui();
  const { agent, provider, model, workspace, memoryPrompt, sid } = opts;

  const { waitUntilExit } = render(
    App({
      agent,
      provider,
      model,
      workspace,
      memoryPrompt,
      sessionId: sid,
      onSaveSession: () => {
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
      },
      onListSessions: () => {
        const sessions = listSessions(workspace, 5);
        return sessions.map(
          (s) =>
            `${s.id}  ${new Date(s.updatedAt).toLocaleString('zh-CN')}  ${s.model}  ${s.messageCount}条`,
        );
      },
      onLoadMemory: () => loadProjectMemory(workspace),
    }),
  );

  await waitUntilExit;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { prompt: initialPrompt, workspace, model, provider, baseUrl: cliBaseUrl, yes, list, resume } = parseArgs();

  // --list
  if (list) {
    await handleList();
    return;
  }

  // 加载配置（命令行 > 环境变量 > 项目配置 > 用户配置）
  const userConfig = loadUserConfig();
  const projectConfig = loadProjectConfig(workspace);
  const resolved = resolveConfig(userConfig, projectConfig);

  const finalProvider = provider || resolved.provider || 'anthropic';
  const finalBaseUrl = cliBaseUrl || resolved.baseUrl || '';

  // API Key: 按 provider 查不同环境变量
  let apiKey = '';
  if (finalProvider === 'anthropic') {
    apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || resolved.apiKey || '';
  } else if (finalProvider === 'openai') {
    apiKey = process.env.OPENAI_API_KEY || resolved.apiKey || '';
  } else {
    // openai-compat: 尝试多个环境变量
    apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || resolved.apiKey || 'not-needed';
  }

  if (!apiKey) {
    console.error(`错误: 请设置 ${finalProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} 环境变量`);
    console.error('或在 ~/.cangjie/config.json 中配置 apiKey');
    process.exit(1);
  }

  // 从 stdin 读入 prompt（管道模式）
  let prompt = initialPrompt;
  if (!prompt && !process.stdin.isTTY) {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) chunks.push(chunk as string);
    prompt = chunks.join('').trim();
  }

  console.log(`\n\x1b[1mCangjie\x1b[0m \x1b[90mv0.2.0\x1b[0m`);
  console.log(`\x1b[90m工作区: ${workspace}\x1b[0m`);
  console.log(`\x1b[90mProvider: ${finalProvider}  模型: ${model}\x1b[0m`);

  // --resume
  let sid: string;
  let history: Message[] | undefined;

  if (resume) {
    const data = loadSession(workspace, resume);
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
    const { agent, memoryPrompt } = createAgent({
      apiKey,
      model,
      provider: finalProvider,
      baseUrl: finalBaseUrl,
      workspace,
      yes,
      sid,
      askRl: undefined,
    });
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

  // ---- 交互模式：TUI（TTY）或 readline 降级 ----
  const useTui = process.stdout.isTTY;

  if (useTui) {
    const { agent, memoryPrompt } = createAgent({
      apiKey,
      model,
      provider: finalProvider,
      baseUrl: finalBaseUrl,
      workspace,
      yes,
      sid,
      askRl: undefined,
    });
    if (history?.length) {
      agent.lastMessages = [{ role: 'system', content: '' }, ...history];
    }
    console.log(`\nCangjie TUI v0.2.0 — 输入 /help 查看帮助\n`);
    await startTui({
      agent,
      provider: finalProvider,
      model,
      workspace,
      memoryPrompt: memoryPrompt || '',
      sid,
    });
    return;
  }

  // ---- 纯文本 REPL 模式（管道/非 TTY） ----
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[1mcj>\x1b[0m ',
  });

  const { agent, memoryPrompt } = createAgent({
    apiKey,
    model,
    provider: finalProvider,
    baseUrl: finalBaseUrl,
    workspace,
    yes,
    sid,
    askRl: rl,
  });
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
        const sessions = listSessions(workspace, 5);
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
