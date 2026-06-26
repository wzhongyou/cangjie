/**
 * ChatView — 对话消息列表
 *
 * 显示消息历史 + 当前流式 thinking 文字 + 底部输入框
 */
import { Box, Text } from 'ink';
import type { ChatMessage, StreamState } from '../hooks/use-agent-stream.js';
import { InputBox } from './InputBox.js';
import { MessageBubble } from './MessageBubble.js';

interface Props {
  state: StreamState;
  onSubmit: (text: string) => void;
  disabled: boolean;
}

export function ChatView({ state, onSubmit, disabled }: Props) {
  const { messages, thinkingText, streaming } = state;

  // Show last 50 messages max (performance)
  const visibleMessages = messages.slice(-50);

  return (
    <Box flexDirection="column">
      {/* Message history */}
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Current streaming thinking text */}
      {streaming && thinkingText ? (
        <Box marginY={0}>
          <Text color="grey">{thinkingText.slice(-500)}</Text>
        </Box>
      ) : null}

      {/* Thinking indicator */}
      {streaming && !thinkingText ? (
        <Box marginY={0}>
          <Text color="grey" dimColor>
            Thinking...
          </Text>
        </Box>
      ) : null}

      {/* Error display */}
      {state.error ? (
        <Box marginY={1}>
          <Text color="red">✗ {state.error}</Text>
        </Box>
      ) : null}

      {/* Input */}
      <Box marginTop={1}>
        <InputBox
          onSubmit={onSubmit}
          disabled={disabled}
          placeholder={disabled ? 'Agent 执行中...' : '输入提示词或 / 命令...'}
        />
      </Box>
    </Box>
  );
}
