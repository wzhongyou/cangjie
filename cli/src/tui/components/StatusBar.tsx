/**
 * StatusBar — 底部状态栏（模型、Token 用量、步数、Provider）
 */
import { Box, Text } from 'ink';

interface Props {
  model: string;
  provider: string;
  step: number;
  usage: { input: number; output: number };
  streaming: boolean;
  workspace: string;
}

export function StatusBar({ model, provider, step, usage, streaming, workspace }: Props) {
  const wsName = workspace.split('/').pop() || workspace;
  const spinner = streaming ? '⏳' : '✓';

  return (
    <Box flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor="grey" paddingX={1}>
      <Text color="grey">
        {spinner} {provider}/{model}
      </Text>
      <Text color="grey">📁 {wsName}</Text>
      <Text color="grey">
        Step: {step} | In: {formatTokens(usage.input)} | Out: {formatTokens(usage.output)}
      </Text>
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
