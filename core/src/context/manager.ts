/**
 * 上下文管理器 — Token 预算 + 压缩策略
 *
 * 学习要点：
 * - Token 不是字节，1 Token ≈ 0.75 英文单词 ≈ 0.3 中文字
 * - 为什么不在 100% 时压缩：模型在 70%+ 时注意力已经退化
 */

import type { Message } from '@cangjie/shared';
import type { LlmClient } from '../llm/client.js';
import { summarizeMessages, truncateToolResults } from './compaction.js';

export interface ContextConfig {
  maxHistoryTokens: number;
  compactionThreshold: number; // 0-1
  compactionStrategy?: 'truncate' | 'summarize';
}

export class ContextManager {
  constructor(private config: ContextConfig) {}

  /**
   * 估算消息列表的 Token 数
   *
   * 简化实现（生产环境应用 tiktoken 精确计算）：
   * 英文 1 Token ≈ 4 字符，中文 1 Token ≈ 1.5 字符
   */
  estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      const text = msg.content;
      // 粗略估算：混合中英文
      const chineseChars = (text.match(/[一-鿿]/g) || []).length;
      const otherChars = text.length - chineseChars;
      total += Math.ceil(chineseChars / 1.5 + otherChars / 4);
    }
    return total;
  }

  /**
   * 检查是否需要压缩，返回裁剪后的消息数量。
   *
   * 策略（由 compactionStrategy 控制）：
   * - truncate: 保留后 60% 消息（当前默认）
   * - summarize: 用 LLM 总结前 50% 消息
   *
   * 返回裁剪后应保留的消息数量（用于 messages.length = ...）。
   */
  maybeCompact(messages: Message[]): number {
    const tokens = this.estimateTokens(messages);
    const threshold = this.config.maxHistoryTokens * this.config.compactionThreshold;

    if (tokens < threshold) {
      return messages.length; // 无需压缩
    }

    // 简单策略：保留后 60% 消息
    const keepCount = Math.floor(messages.length * 0.6);
    return Math.max(4, keepCount);
  }

  /**
   * 带 LLM 摘要的压缩（用于 summarize 策略）。
   * 在 agent-loop 中调用，替换早期消息为摘要。
   *
   * 返回压缩后的消息列表。
   */
  async compactWithSummary(messages: Message[], llm: LlmClient): Promise<Message[]> {
    const tokens = this.estimateTokens(messages);
    const threshold = this.config.maxHistoryTokens * this.config.compactionThreshold;

    if (tokens < threshold) {
      return messages;
    }

    // Token > 85%: 总结前 50% 消息
    if (tokens > this.config.maxHistoryTokens * 0.85) {
      const summarized = await summarizeMessages(messages, llm, Math.floor(messages.length * 0.5));
      return summarized;
    }

    // Token > 70%: 总结前 30% 消息
    if (tokens > this.config.maxHistoryTokens * 0.7) {
      const summarized = await summarizeMessages(messages, llm, Math.floor(messages.length * 0.7));
      return summarized;
    }

    return messages;
  }

  /**
   * Token > 92% 的紧急压缩：激进截断
   */
  emergencyCompact(messages: Message[]): Message[] {
    return truncateToolResults(messages, Math.floor(messages.length * 0.3));
  }
}
