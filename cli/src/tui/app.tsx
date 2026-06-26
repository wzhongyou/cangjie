/**
 * Cangjie TUI App
 *
 * Ink 顶层组件。管理所有状态：Agent 运行、消息历史、权限确认、斜杠命令。
 */
import { Box, Text, useApp as useInkApp, useInput } from 'ink';
import { useCallback, useMemo, useState } from 'react';
import type { CangjieAgent } from '@cangjie/core';
import { ChatView } from './components/ChatView.js';
import { PlanPanel } from './components/PlanPanel.js';
import { StatusBar } from './components/StatusBar.js';
import {
  PermissionPromptView,
  usePermissionPrompt,
  requestPermission,
  getSessionDecision,
} from './components/PermissionPrompt.js';
import { useAgentStream } from './hooks/use-agent-stream.js';
import {
  CommandRegistry,
  type CommandContext,
} from '../commands/registry.js';
import { helpCommand } from '../commands/builtin/help.js';
import { saveCommand } from '../commands/builtin/save.js';
import { memoryCommand } from '../commands/builtin/memory.js';
import { listCommand } from '../commands/builtin/list.js';
import { clearCommand } from '../commands/builtin/clear.js';
import { exitCommand } from '../commands/builtin/exit.js';

/** 工具 → 风险等级映射 */
function toolRisk(tool: string): 'write' | 'execute' | 'network' {
  switch (tool) {
    case 'bash':
      return 'execute';
    case 'write_file':
    case 'edit_file':
      return 'write';
    case 'web_fetch':
    case 'web_search':
      return 'network';
    default:
      return 'write';
  }
}

interface AppConfig {
  agent: CangjieAgent;
  provider: string;
  model: string;
  workspace: string;
  memoryPrompt: string;
  sessionId: string;
  /** 外部注入：保存会话 */
  onSaveSession: () => void;
  /** 列出会话 meta 文本 */
  onListSessions: () => string[];
  /** 加载项目记忆 */
  onLoadMemory: () => string;
}

export function App({
  agent,
  provider,
  model,
  workspace,
  memoryPrompt,
  onSaveSession,
  onListSessions,
  onLoadMemory,
}: AppConfig) {
  const { state, run, abort } = useAgentStream();
  const { pending } = usePermissionPrompt();
  const { exit } = useInkApp();
  const [isFirstTurn, setIsFirstTurn] = useState(true);

  // Setup slash commands
  const commands = useMemo(() => {
    const ctx: CommandContext = {
      print(text) {
        // We'll use a state append approach
        // For now, use process.stderr for command output
        process.stderr.write(`${text}\n`);
      },
      workspace,
      saveSession: onSaveSession,
      listSessions: onListSessions,
      loadMemory: onLoadMemory,
      exit,
    };

    const registry = new CommandRegistry();
    registry.register(helpCommand);
    registry.register(saveCommand);
    registry.register(memoryCommand);
    registry.register(listCommand);
    registry.register(clearCommand);
    registry.register(exitCommand);
    return { registry, ctx };
  }, [workspace, onSaveSession, onListSessions, onLoadMemory, exit]);

  // Handle Ctrl+C globally
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (state.streaming) {
        abort();
      } else {
        onSaveSession();
        exit();
      }
    }
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      // Check if it's a slash command
      if (text.startsWith('/')) {
        const parts = text.slice(1).split(/\s+/);
        const cmdName = parts[0]?.toLowerCase();
        if (cmdName === 'q') {
          // alias for exit
          commands.ctx.saveSession();
          commands.ctx.print('再见 👋');
          commands.ctx.exit();
          return;
        }
        if (commands.registry.has(cmdName)) {
          commands.registry.execute(cmdName, commands.ctx);
          return;
        }
        commands.ctx.print(`未知命令: /${cmdName}。输入 /help 查看可用命令。`);
        return;
      }

      // Override permission: use TUI prompt with session memory
      const originalCheck = (agent as any).permission.check.bind(
        (agent as any).permission,
      );
      (agent as any).permission.check = async (
        tool: string,
        args: Record<string, unknown>,
      ) => {
        const decision = await originalCheck(tool, args);
        if (decision.action !== 'ask') return decision;

        // 会话级记忆：之前选了 A/D 就不再问
        const remembered = getSessionDecision(tool);
        if (remembered === 'allow-always') return { action: 'allow' as const };
        if (remembered === 'deny-always')
          return { action: 'deny' as const, reason: '本次对话已拒绝此工具' };

        // 确定风险等级
        const risk = toolRisk(tool);

        // 弹出确认
        const result = await requestPermission(tool, args, risk);
        if (result === 'allow-once' || result === 'allow-always') {
          return { action: 'allow' as const };
        }
        return { action: 'deny' as const, reason: '用户拒绝' };
      };

      // Build agent input
      const history = agent.lastMessages.filter(
        (m: any) => m.role !== 'system',
      );
      const systemPrompt =
        isFirstTurn && memoryPrompt ? memoryPrompt : undefined;
      if (isFirstTurn) setIsFirstTurn(false);

      const agentRun = agent.run(
        { prompt: text, history: history.length > 0 ? history : undefined, systemPrompt },
        new AbortController().signal,
      );

      await run(agentRun, text);

      // Auto-save after each turn
      if (agent.lastMessages.length > 0) {
        onSaveSession();
      }
    },
    [agent, memoryPrompt, isFirstTurn, run, commands, onSaveSession],
  );

  // Determine if a command is being shown (we intercept /commands and don't run agent)
  const isCommand = false; // Handled synchronously in handleSubmit

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>
          Cangjie
        </Text>
        <Text color="grey" dimColor>
          {' '}v0.2.0
        </Text>
        <Text color="grey">
          {' '}| {provider}/{model} | 📁{' '}
          {workspace.split('/').pop() || workspace}
        </Text>
      </Box>

      {/* Plan panel */}
      <PlanPanel todos={state.todos} visible={state.todos.length > 0} />

      {/* Permission prompt */}
      {pending ? <PermissionPromptView request={pending} /> : null}

      {/* Main chat area */}
      <ChatView state={state} onSubmit={handleSubmit} disabled={state.streaming} />

      {/* Status bar */}
      <StatusBar
        model={model}
        provider={provider}
        step={state.step}
        usage={state.usage}
        streaming={state.streaming}
        workspace={workspace}
      />
    </Box>
  );
}
