/**
 * MessageBubble — 单条消息渲染
 */
import { Box, Text } from 'ink';
import type { ChatMessage } from '../hooks/use-agent-stream.js';
import { DiffView } from './DiffView.js';

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  switch (message.role) {
    case 'user':
      return (
        <Box flexDirection="column" marginY={1}>
          <Text bold color="white">
            {'>'} {message.content}
          </Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box flexDirection="column" marginY={1}>
          <MarkdownContent content={message.content} />
        </Box>
      );

    case 'tool':
      return (
        <Box flexDirection="column" marginY={0}>
          <Text color="cyan" dimColor>
            🔧 {message.toolName}
            {message.toolArgs ? ` ${JSON.stringify(message.toolArgs).slice(0, 150)}` : ''}
          </Text>
          {message.content ? (
            <Text color="grey" dimColor>
              {message.content.slice(0, 500)}
            </Text>
          ) : null}
          {message.toolDuration != null ? (
            <Text color="grey" dimColor>
              ⏱ {message.toolDuration}ms
            </Text>
          ) : null}
        </Box>
      );

    case 'system':
      return (
        <Box marginY={0}>
          <Text color="yellow" dimColor>
            {message.content}
          </Text>
        </Box>
      );

    default:
      return null;
  }
}

/**
 * 简易 Markdown 渲染：代码块用 DiffView 展示，
 * 普通文本直接显示。
 */
function MarkdownContent({ content }: { content: string }) {
  const segments = parseMarkdownSegments(content);

  return (
    <Box flexDirection="column">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          // 如果代码块内容像 diff，用 DiffView
          if (looksLikeDiff(seg.content)) {
            return <DiffView key={i} diffText={seg.content} language={seg.language} />;
          }
          return (
            <Box key={i} borderStyle="round" borderColor="grey" paddingX={1} marginY={1}>
              <Text color="grey">{seg.content.slice(0, 2000)}</Text>
            </Box>
          );
        }
        if (seg.type === 'inlineCode') {
          return (
            <Text key={i} backgroundColor="grey" color="white">
              {seg.content}
            </Text>
          );
        }
        if (seg.type === 'bold') {
          return (
            <Text key={i} bold>
              {seg.content}
            </Text>
          );
        }
        return (
          <Text key={i} color="green">
            {seg.content}
          </Text>
        );
      })}
    </Box>
  );
}

interface MarkdownSegment {
  type: 'text' | 'code' | 'inlineCode' | 'bold';
  content: string;
  language?: string;
}

function parseMarkdownSegments(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  // Split by code blocks (``` ... ```)
  const parts = text.split(/(```(\w*)\n?[\s\S]*?```)/g);
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];
    if (!part) {
      i++;
      continue;
    }

    // Code block: starts with ```
    if (part.startsWith('```')) {
      const langMatch = part.match(/```(\w*)\n?/);
      const language = langMatch?.[1] || undefined;
      const codeContent = part.replace(/```\w*\n?/, '').replace(/```$/, '').trim();
      segments.push({ type: 'code', content: codeContent, language });
      i++;
      continue;
    }

    // Regular text: parse inline code and bold
    const inlineParts = part.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    for (const ip of inlineParts) {
      if (ip.startsWith('`') && ip.endsWith('`')) {
        segments.push({ type: 'inlineCode', content: ip.slice(1, -1) });
      } else if (ip.startsWith('**') && ip.endsWith('**')) {
        segments.push({ type: 'bold', content: ip.slice(2, -2) });
      } else if (ip.trim()) {
        segments.push({ type: 'text', content: ip });
      }
    }
    i++;
  }

  return segments;
}

function looksLikeDiff(text: string): boolean {
  const lines = text.split('\n');
  let diffCount = 0;
  for (const line of lines.slice(0, 10)) {
    if (/^[+\-]/.test(line) || /^@@\s/.test(line) || /^diff\s/.test(line)) {
      diffCount++;
    }
  }
  return diffCount >= 2;
}
