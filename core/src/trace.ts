/**
 * 全链路 Trace — 轻量级 Span 收集
 *
 * 在关键节点收集 span，会话结束时输出 summary。
 */
import { agentLog } from './logger.js';

export type SpanType = 'llm_call' | 'tool_exec' | 'compaction' | 'permission_check';

export interface Span {
  spanId: string;
  parentSpanId?: string;
  type: SpanType;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  metadata: {
    model?: string;
    tool?: string;
    step?: number;
    tokenUsage?: { input: number; output: number };
    durationMs?: number;
    errorMessage?: string;
  };
}

let spanCounter = 0;

export class Trace {
  traceId: string;
  sessionId: string;
  startTime: number;
  endTime?: number;
  spans: Span[] = [];

  constructor(sessionId: string) {
    this.traceId = `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.sessionId = sessionId;
    this.startTime = Date.now();
  }

  /** 开始一个 span，返回 spanId */
  startSpan(type: SpanType, metadata: Span['metadata'] = {}): string {
    const spanId = `${type}-${++spanCounter}`;
    this.spans.push({
      spanId,
      type,
      startTime: Date.now(),
      status: 'ok',
      metadata: {
        ...metadata,
        step: metadata.step,
      },
    });
    agentLog.debug({ spanId, type, ...metadata }, 'Span started');
    return spanId;
  }

  /** 结束一个 span */
  endSpan(spanId: string, status: Span['status'] = 'ok', errorMessage?: string): void {
    const span = this.spans.find((s) => s.spanId === spanId);
    if (span) {
      span.endTime = Date.now();
      span.status = status;
      span.metadata.durationMs = span.endTime - span.startTime;
      if (errorMessage) span.metadata.errorMessage = errorMessage;
      agentLog.debug({ spanId, status, durationMs: span.metadata.durationMs }, 'Span ended');
    }
  }

  /** 完成 trace */
  finish(): void {
    this.endTime = Date.now();
  }

  /** 生成摘要 */
  summary(): string {
    const totalDuration = (this.endTime ?? Date.now()) - this.startTime;
    const llmSpans = this.spans.filter((s) => s.type === 'llm_call');
    const toolSpans = this.spans.filter((s) => s.type === 'tool_exec');
    const errors = this.spans.filter((s) => s.status === 'error');
    const totalTokens = llmSpans.reduce(
      (acc, s) => ({
        input: acc.input + (s.metadata.tokenUsage?.input ?? 0),
        output: acc.output + (s.metadata.tokenUsage?.output ?? 0),
      }),
      { input: 0, output: 0 },
    );

    return [
      `Trace: ${this.traceId}`,
      `Duration: ${(totalDuration / 1000).toFixed(1)}s`,
      `LLM calls: ${llmSpans.length} | Tools: ${toolSpans.length} | Errors: ${errors.length}`,
      `Tokens: ${totalTokens.input} in / ${totalTokens.output} out`,
      `Steps: ${llmSpans.length}`,
    ].join('\n');
  }
}
