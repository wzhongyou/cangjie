/**
 * DiffView — 语法高亮的 diff 展示
 */
import { Box, Text } from 'ink';

interface Props {
  diffText: string;
  language?: string;
}

export function DiffView({ diffText, language }: Props) {
  const lines = diffText.split('\n');
  const displayLines = lines.slice(0, 100); // 最多显示 100 行
  const truncated = lines.length > displayLines.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="grey" paddingX={1} marginY={1}>
      {language ? (
        <Text color="grey" dimColor>
          ```{language}
        </Text>
      ) : null}
      {displayLines.map((line, i) => (
        <DiffLine key={i} line={line} />
      ))}
      {truncated ? (
        <Text color="grey" dimColor>
          ... ({lines.length - displayLines.length} more lines)
        </Text>
      ) : null}
    </Box>
  );
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith('@@')) {
    return <Text color="cyan">{line}</Text>;
  }
  if (line.startsWith('---') || line.startsWith('+++')) {
    return <Text color="cyan" bold>{line}</Text>;
  }
  if (line.startsWith('+')) {
    return <Text color="green">{line}</Text>;
  }
  if (line.startsWith('-')) {
    return <Text color="red">{line}</Text>;
  }
  if (line.startsWith('diff ')) {
    return <Text color="cyan" dimColor>{line}</Text>;
  }
  return <Text color="grey">{line}</Text>;
}
