/**
 * 上下文压缩策略
 *
 * 对标 Claude Code wU2 / Codex 可靠压缩（13/13 召回）。
 *
 * 策略：
 *   1. summarize — 用 LLM 总结前 50% 消息，替换为摘要
 *   2. truncate  — 裁剪最早的工具结果（当前实现）
 *   3. checkpoint — 95%+ 时全量压缩 + 保存检查点
 */
import type { Message } from '@cangjie/shared';
import type { LlmClient } from '../llm/client.js';

/**
 * 用 LLM 总结早期对话历史，返回压缩后的消息列表。
 *
 * 压缩原则：
 * - 保留 system prompt（第一条 system 消息）
 * - 保留最近 N 轮完整内容
 * - 早期内容总结为单个 system 消息注入
 */
export async function summarizeMessages(messages: Message[], llm: LlmClient, keepRecent = 10): Promise<Message[]> {
  if (messages.length <= keepRecent + 4) {
    return messages; // 消息太少，不值得总结
  }

  const systemMsg = messages[0]?.role === 'system' ? [messages[0]] : [];
  const toSummarize = messages.slice(systemMsg.length, -keepRecent);
  const toKeep = messages.slice(-keepRecent);

  // 只总结 user/assistant 对话，跳过工具调用细节
  const conversationParts = toSummarize
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.toolCalls?.length))
    .map((m) => `[${m.role}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n');

  if (!conversationParts.trim()) {
    return [...systemMsg, ...toKeep];
  }

  try {
    const response = await llm.chat({
      messages: [
        {
          role: 'user',
          content: `请用中文简要总结以下对话历史的关键信息（任务目标、已完成的工作、重要发现、未解决的问题）。\n\n限制在 500 字以内。\n\n对话历史：\n\n${conversationParts}`,
        },
      ],
      maxTokens: 600,
    });

    const summary = response.message.content || '(摘要生成失败)';
    const summaryMsg: Message = {
      role: 'system',
      content: `[会话摘要 — 早期对话]\n\n${summary}`,
    };

    return [...systemMsg, summaryMsg, ...toKeep];
  } catch {
    // 总结失败，fallback 到截断
    return [...systemMsg, ...toKeep];
  }
}

/**
 * 裁剪最新的工具调用结果。
 * 保留 system + 最后 N 条非工具消息 + 对应工具结果。
 */
export function truncateToolResults(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) return messages;

  const systemMsgs = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  // 保留最近的 maxMessages 条
  const keep = nonSystem.slice(-maxMessages);

  return [...systemMsgs, ...keep];
}
