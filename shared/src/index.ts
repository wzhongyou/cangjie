// @cangjie/shared — 共享类型定义

// ============================================================
// Agent 消息类型
// ============================================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============================================================
// Agent 事件（流式输出）
// ============================================================

export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string; duration: number }
  | { type: 'response'; content: string }
  | { type: 'error'; error: string }
  | { type: 'done'; steps: number }
  | { type: 'file_changed'; filePath: string; preContent: string; postContent: string };

// ============================================================
// LLM 流式事件（token 级别）
// ============================================================

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; arguments: string }
  | { type: 'tool_use_end'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'done'; usage: { input: number; output: number } };

// ============================================================
// LLM 客户端接口
// ============================================================

export interface LlmConfig {
  provider: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  baseUrl?: string;
}

export interface LlmRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  message: Message;
  usage: { input: number; output: number };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// ============================================================
// 工具系统
// ============================================================

export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  signal: AbortSignal;
}

export interface ToolResult {
  content: string;
  error?: string;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ============================================================
// 权限
// ============================================================

export type PermissionAction = 'allow' | 'deny' | 'ask';
export type RiskLevel = 'readonly' | 'write' | 'execute' | 'network';

export interface PermissionDecision {
  action: PermissionAction;
  reason?: string;
}

// ============================================================
// 配置
// ============================================================

export interface CangjieConfig {
  llm: LlmConfig;
  permissions: {
    autoAllowReadOnly: boolean;
    rules: PermissionRule[];
  };
  context: {
    maxHistoryTokens: number;
    compactionThreshold: number; // 0-1, 默认 0.85
  };
}

export interface PermissionRule {
  tool: string;
  pattern?: string; // glob 匹配文件路径
  action: PermissionAction;
}
