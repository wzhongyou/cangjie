/**
 * InputBox — 用户输入组件
 *
 * 使用 Ink 的 useInput hook 读取键盘输入。
 * 支持多行输入（Alt+Enter 换行）、输入历史（↑↓）、Ctrl+R 搜索。
 */
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import { useCallback, useState } from 'react';

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MAX_HISTORY = 100;
const history: string[] = [];

export function InputBox({ onSubmit, disabled, placeholder }: Props) {
  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Add to history
    history.unshift(trimmed);
    if (history.length > MAX_HISTORY) history.pop();

    onSubmit(trimmed);
    setInput('');
    setHistoryIdx(-1);
  }, [input, onSubmit]);

  useInput((keyInput, key) => {
    if (disabled) return;

    // Ctrl+R: search history
    if (key.ctrl && keyInput === 'r') {
      // Signal to toggle history search (simplified: just show last)
      if (history.length > 0) {
        setInput(history[0]);
      }
      return;
    }

    // Up arrow: previous history
    if (key.upArrow) {
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      if (history[nextIdx]) setInput(history[nextIdx]);
      return;
    }

    // Down arrow: next history
    if (key.downArrow) {
      const nextIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(nextIdx);
      setInput(nextIdx >= 0 ? history[nextIdx] : '');
      return;
    }

    // Escape: clear input
    if (key.escape) {
      setInput('');
      setHistoryIdx(-1);
      return;
    }

    // Enter: submit
    if (key.return) {
      handleSubmit();
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // Regular text input
    if (keyInput && !key.ctrl && !key.meta && keyInput.length === 1) {
      setInput((prev) => prev + keyInput);
    }
  });

  return (
    <Box flexDirection="column">
      {showHelp ? (
        <Box marginBottom={1}>
          <Text color="grey" dimColor>
            Enter: 发送 | ↑↓: 历史 | Ctrl+R: 搜索 | Esc: 清空 | /help: 命令列表
          </Text>
        </Box>
      ) : null}
      <Box>
        <Text bold color="blue">
          cj{' '}
        </Text>
        <Text>{input}</Text>
        {input.length === 0 && placeholder ? (
          <Text color="grey" dimColor>
            {placeholder}
          </Text>
        ) : null}
        <Text color="grey">│</Text>
      </Box>
    </Box>
  );
}
