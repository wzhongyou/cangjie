/** TUI 配色主题 */
export interface Theme {
  name: string;
  thinking: string; // 模型思考文字颜色
  toolCall: string; // 工具调用
  toolResult: string; // 工具结果
  response: string; // 模型回复
  error: string; // 错误
  plan: string; // 任务计划
  compact: string; // 上下文压缩
  muted: string; // 辅助信息
  user: string; // 用户输入
  diffAdd: string; // diff 新增行
  diffRemove: string; // diff 删除行
  diffHeader: string; // diff 文件头
  statusBar: string; // 状态栏背景
  border: string; // 边框
}

export const defaultTheme: Theme = {
  name: 'default',
  thinking: 'grey',
  toolCall: 'cyan',
  toolResult: 'grey',
  response: 'green',
  error: 'red',
  plan: 'magenta',
  compact: 'yellow',
  muted: 'grey',
  user: 'white',
  diffAdd: 'green',
  diffRemove: 'red',
  diffHeader: 'cyan',
  statusBar: 'grey',
  border: 'grey',
};
