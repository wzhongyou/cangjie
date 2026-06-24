/**
 * 上下文管理器 — Token 预算 + 压缩策略
 *
 * 学习要点：
 * - Token 不是字节，1 Token ≈ 0.75 英文单词 ≈ 0.3 中文字
 * - 为什么不在 100% 时压缩：模型在 70%+ 时注意力已经退化
 */

import type { Message } from '@cangjie/shared';

export interface ContextConfig {
  maxHistoryTokens: number;
  compactionThreshold: number; // 0-1
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
   * 检查是否需要压缩，如需要则返回裁剪后的消息列表。
   * 裁剪策略：丢掉最早的工具调用结果，保留最近的上下文。
   */
  maybeCompact(messages: Message[]): number {
    const tokens = this.estimateTokens(messages);
    if (tokens < this.config.maxHistoryTokens * this.config.compactionThreshold) {
      return messages.length; // 无需压缩
    }

    // 简单策略：保留后 60% 消息
    const keepCount = Math.floor(messages.length * 0.6);
    // 确保至少保留 system prompt + 最新几轮
    return Math.max(4, keepCount);
  }
}
