/**
 * PermissionPrompt — 工具执行确认弹窗
 *
 * 按风险等级展示不同信息：
 *  - execute (bash):    完整命令 + 工作目录
 *  - write (write/edit): 文件路径 + diff 预览
 *  - network (web_*):    URL
 *
 * 四种决策：
 *  [Y] 允许本次   [A] 本次对话始终允许
 *  [N] 拒绝       [D] 本次对话始终拒绝
 */
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import { useCallback, useMemo, useState } from 'react';

export type PromptDecision = 'allow-once' | 'allow-always' | 'deny-once' | 'deny-always';

export interface PromptRequest {
  tool: string;
  args: Record<string, unknown>;
  risk: 'write' | 'execute' | 'network';
  resolve: (decision: PromptDecision) => void;
}

let pendingPrompt: PromptRequest | null = null;
let promptListeners: Array<() => void> = [];

export function requestPermission(
  tool: string,
  args: Record<string, unknown>,
  risk: 'write' | 'execute' | 'network',
): Promise<PromptDecision> {
  return new Promise((resolve) => {
    pendingPrompt = { tool, args, risk, resolve };
    promptListeners.forEach((l) => l());
  });
}

export function usePermissionPrompt() {
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useState(() => {
    promptListeners.push(refresh);
    return () => {
      promptListeners = promptListeners.filter((l) => l !== refresh);
    };
  });

  return { pending: pendingPrompt };
}

export function resolvePermission(decision: PromptDecision) {
  if (pendingPrompt) {
    pendingPrompt.resolve(decision);
    pendingPrompt = null;
    promptListeners.forEach((l) => l());
  }
}

// ============================================================
// 会话级决策记忆：同一对话内 A/D 后不再询问
// ============================================================

const sessionDecisions = new Map<string, PromptDecision>();

export function clearSessionDecisions() {
  sessionDecisions.clear();
}

export function getSessionDecision(tool: string): PromptDecision | undefined {
  return sessionDecisions.get(tool);
}

export function setSessionDecision(tool: string, decision: PromptDecision) {
  if (decision === 'allow-always' || decision === 'deny-always') {
    sessionDecisions.set(tool, decision);
  }
}

// ============================================================
// UI 组件
// ============================================================

interface Props {
  request: PromptRequest;
}

export function PermissionPromptView({ request }: Props) {
  useInput((input, _key) => {
    switch (input.toLowerCase()) {
      case 'y':
        setSessionDecision(request.tool, 'allow-once');
        resolvePermission('allow-once');
        break;
      case 'a':
        setSessionDecision(request.tool, 'allow-always');
        resolvePermission('allow-always');
        break;
      case 'n':
        setSessionDecision(request.tool, 'deny-once');
        resolvePermission('deny-once');
        break;
      case 'd':
        setSessionDecision(request.tool, 'deny-always');
        resolvePermission('deny-always');
        break;
    }
  });

  const riskLabel = useMemo(() => {
    switch (request.risk) {
      case 'execute':
        return { color: 'red' as const, label: '命令执行' };
      case 'write':
        return { color: 'yellow' as const, label: '文件写入' };
      case 'network':
        return { color: 'blue' as const, label: '网络请求' };
    }
  }, [request.risk]);

  // 提取展示信息
  const preview = useMemo(() => buildPreview(request), [request]);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={riskLabel.color} paddingX={1} marginY={1}>
      <Text bold color={riskLabel.color}>
        ⚠️ 执行确认 ({riskLabel.label})
      </Text>

      {preview.map((line, i) => (
        <Text key={i} dimColor={i > 0}>
          {line}
        </Text>
      ))}

      <Box marginTop={1} flexDirection="row" gap={2}>
        <Text>
          [<Text bold color="green">Y</Text>] 允许本次
        </Text>
        <Text>
          [<Text bold color="green">A</Text>] 始终允许
        </Text>
        <Text>
          [<Text bold color="red">N</Text>] 拒绝
        </Text>
        <Text>
          [<Text bold color="red">D</Text>] 始终拒绝
        </Text>
      </Box>
    </Box>
  );
}

// ============================================================
// 预览信息构建：按工具类型展示不同的上下文
// ============================================================

function buildPreview(request: PromptRequest): string[] {
  const { tool, args } = request;
  const lines: string[] = [];

  switch (tool) {
    case 'bash': {
      const cmd = String(args.command ?? '');
      lines.push(`命令: ${cmd}`);
      if (args.timeout) lines.push(`超时: ${args.timeout}ms`);
      break;
    }
    case 'write_file': {
      const filePath = String(args.file_path ?? '');
      const content = String(args.content ?? '');
      const lineCount = content.split('\n').length;
      const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
      lines.push(`文件: ${filePath}`);
      lines.push(`大小: ${sizeKB}KB (${lineCount} 行)`);
      // 展示前 5 行作为预览
      const preview = content.split('\n').slice(0, 5);
      lines.push('');
      lines.push('内容预览:');
      for (const l of preview) {
        lines.push(`  ${l.slice(0, 120)}`);
      }
      if (content.split('\n').length > 5) lines.push('  ...');
      break;
    }
    case 'edit_file': {
      const filePath = String(args.file_path ?? '');
      const oldStr = String(args.old_string ?? '');
      const newStr = String(args.new_string ?? '');
      lines.push(`文件: ${filePath}`);
      lines.push('');
      lines.push('替换:');
      lines.push(`  - ${oldStr.slice(0, 80)}`);
      lines.push(`  + ${newStr.slice(0, 80)}`);
      break;
    }
    case 'web_fetch':
    case 'web_search': {
      const url = String(args.url ?? args.query ?? '');
      lines.push(`URL: ${url}`);
      break;
    }
    default:
      lines.push(`工具: ${tool}`);
      lines.push(`参数: ${JSON.stringify(args).slice(0, 200)}`);
  }

  return lines;
}
