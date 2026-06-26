/**
 * PlanPanel — 任务计划侧边栏（展示 todo_write 的当前任务列表）
 */
import { Box, Text } from 'ink';
import type { TodoItem } from '../hooks/use-agent-stream.js';

interface Props {
  todos: TodoItem[];
  visible: boolean;
}

export function PlanPanel({ todos, visible }: Props) {
  if (!visible || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} marginY={1}>
      <Text bold color="magenta">
        📋 任务计划 ({completed}/{total})
      </Text>
      {todos.map((todo) => (
        <Box key={todo.id}>
          <Text color="magenta">
            {todo.status === 'completed' ? '  ✅' : todo.status === 'in_progress' ? '  🔄' : '  ⏳'}
          </Text>
          <Text color={todo.status === 'completed' ? 'grey' : 'white'} dimColor={todo.status === 'completed'}>
            {' '}{todo.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
