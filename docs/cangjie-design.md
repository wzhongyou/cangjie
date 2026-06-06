# Cangjie（仓颉）设计文档

> **定位**：AI 原生代码智能平台 — 融合混合检索、RAG 与 Agent 能力，用于代码搜索、理解与自动化演进。
>
> **对标**：Cursor 的 IDE 交互 × Claude Code 的 Agent 脑子 × 本地优先的代码知识库
>
> **技术栈**：TypeScript 全栈主导，Rust 聚焦性能关键路径。工业级架构，每个决策讲清楚 WHY。

---

## 0. 调研结论：Cursor 和 Claude Code 的本质差异

### 0.1 核心差异矩阵

| 维度 | Cursor | Claude Code | 根源分析 |
|------|--------|-------------|---------|
| **Agent 自主性** | 单轮为主，Tab/Inline/单次Chat | 自主循环，长任务执行（10-100步+） | Cursor 的 Agent 是"辅助"，CC 的 Agent 是"替代" |
| **工具调用深度** | 有限 IDE 操作（补全、跳转、重构） | Bash + File + Grep + Task + Web 全栈 | CC 暴露了全套 OS 能力给 Agent |
| **上下文策略** | RAG embedding + 当前文件 + 少量关联文件 | 全项目扫描（grep/glob） + Memory 文件 + 上下文压缩 | CC 依赖模型"自己去找"，Cursor 依赖"提前找好" |
| **规划能力** | 无显式规划（单步响应） | Plan → Execute → Verify 隐式循环 | CC 的 TodoWrite 工具强制规划 |
| **IDE 体验** | Tab 补全、Inline Edit、Diff Preview | 终端纯文本 + Markdown | Cursor 胜在图形化交互 |
| **响应延迟** | Tab < 150ms / Chat < 2s | 秒级首 Token | Cursor 用三级缓存 + 小模型优化 |
| **执行模型** | 同步（用户触发 → 响应） | 异步（Agent 自主循环，用户可中途介入） | CC 有 h2A 双缓冲队列支持实时干预 |
| **代码搜索** | 语义向量 + Grep 混合 | 仅 Grep/Glob（刻意不用向量） | 哲学差异：统计匹配 vs 精确匹配 |
| **文件修改** | 直接写入（含 Diff 预览） | Diff-first（先生成 Diff，用户 Accept/Reject） | CC 的 Edit 工具是外科手术式的 |
| **隐私模型** | 索引云端化（源码不上传，但 embedding 上传） | 完全本地（API 直连，无中间服务器） | Cursor 有中间服务，CC 无 |

### 0.2 两种设计哲学的碰撞

```
Cursor 哲学: "给用户最好的答案，尽可能快"
  → 预计算（索引）+ 预加载（RAG）+ 预缓存（三级缓存）
  → Agent 是最后一步，不是第一步
  → 技术栈：Rust 重计算 + Cloud GPU + 复杂基础设施

Claude Code 哲学: "给模型最好的工具，然后让开"
  → 不预计算，模型自己 grep/read/think
  → Agent 是第一步，一切围绕 Agent Loop 构建
  → 技术栈：TypeScript 单体 + 简单基础设施
```

### 0.3 Cangjie 的融合策略

```
Cangjie = Cursor 的搜索预计算 + Claude Code 的 Agent 自主性 + Cursor 的 IDE 图形体验
```

**关键洞察**：两者不是互斥的。可以让 Agent 同时拥有"预计算的知识库"和"实时探索的工具"，在同一个 Agent Loop 中自主选择最快的路径。

---

## 1. 总体架构

### 1.1 三层架构（TypeScript-first）

```
┌──────────────────────────────────────────────────────────────────┐
│                    IDE Layer (TypeScript)                         │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌────────┐  ┌────────────────┐   │
│  │  Chat    │  │  Inline   │  │  Diff  │  │  Agent Panel   │   │
│  │  Panel   │  │  Edit     │  │ Review │  │ (Plan/Exec/✓)  │   │
│  └────┬─────┘  └─────┬─────┘  └───┬────┘  └───────┬────────┘   │
│       └──────────────┴────────────┴───────────────┘             │
│                         │                                        │
│             ┌───────────▼────────────┐                           │
│             │   UX Coordinator       │                           │
│             │  (Zustand Store +       │                           │
│             │   Command Router)       │                           │
│             └───────────┬────────────┘                           │
└─────────────────────────┼────────────────────────────────────────┘
                          │ JSON-RPC over Unix Socket
┌─────────────────────────┼────────────────────────────────────────┐
│                         │                                        │
│              Agent Runtime (TypeScript)                           │
│                                                                  │
│  ┌──────────────────────┴─────────────────────────────┐         │
│  │             Agent Orchestrator                       │         │
│  │  (Plan → Execute → Verify → Loop — TypeScript)      │         │
│  └────────┬──────────────────────────────┬────────────┘         │
│           │                              │                       │
│  ┌────────▼──────────┐    ┌─────────────▼────────────┐         │
│  │   Tool System     │    │   Context Engine         │         │
│  │   (TypeScript)    │    │   (TypeScript)            │         │
│  │  ┌──────────────┐ │    │  ┌────────────────────┐  │         │
│  │  │ read/write   │ │    │  │ TokenBudget        │  │         │
│  │  │ edit/grep    │ │    │  │ CompactionStrategy │  │         │
│  │  │ bash/glob    │ │    │  │ ProjectContext     │  │         │
│  │  │ task/web_*   │ │    │  │ MemorySystem       │  │         │
│  │  │ lsp/search   │ │    │  └────────────────────┘  │         │
│  │  └──────────────┘ │    └──────────────────────────┘         │
│  └────────┬──────────┘                                         │
│           │                                                     │
│  ┌────────▼────────────────────────────────────────┐          │
│  │        Code Knowledge Base (Rust + TS Bridge)     │          │
│  │  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │          │
│  │  │ AST Index │  │ Full-Text│  │ Vector Index  │  │          │
│  │  │(tree-sitter)│ │ (BM25)  │  │ (LanceDB)     │  │          │
│  │  └───────────┘  └──────────┘  └──────────────┘  │          │
│  └──────────────────────────────────────────────────┘          │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │   Permission Pipeline  │  Session Manager         │          │
│  │   (TypeScript)        │  (TypeScript + SQLite)   │          │
│  └──────────────────────────────────────────────────┘          │
└─────────────────────────┬──────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────────┐
│                    LLM Gateway (TypeScript)                      │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐    │
│  │  Claude  │  │  GPT-5   │  │  Gemini  │  │  Local/Ollama│   │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘    │
│                                                                  │
│  统一接口：Streaming │ Fallback │ Retry │ Rate Limit │ Billing  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 为什么是这三层

| 层 | 职责 | 语言 | 为什么独立 |
|----|------|------|-----------|
| **IDE Layer** | UI、交互、编辑体验 | TypeScript | VSCode 生态原生，必须同进程 |
| **Agent Runtime** | 循环、工具、上下文、权限 | TypeScript | 逻辑密集，与 IDE 解耦可独立测试 |
| **LLM Gateway** | 模型路由、Fallback、限流 | TypeScript | 模型无关，可独立扩缩 |

**关键原则**：
1. IDE 层不包含 Agent 逻辑（只做展示和路由）
2. Agent Runtime 不依赖 VSCode API（可独立运行、独立测试）
3. 三层之间的通信协议是唯一的耦合点

### 1.3 为什么不把 Agent Runtime 写成 VSCode Extension 的一部分

这是很多人会犯的错误——把 Agent Loop 塞进 Extension 的 activate() 里：

```typescript
// ❌ 错误做法：Agent Loop 和 VSCode API 耦合
export function activate(context: vscode.ExtensionContext) {
  // Agent 逻辑直接依赖 vscode.workspace, vscode.window...
  // 结果：无法独立测试，无法 CLI 运行，无法复用
}

// ✅ 正确做法：Agent Runtime 是独立的 TypeScript 包
// packages/agent-runtime/
//   完全不 import 'vscode'
//   可以独立运行：npx cj "帮我修 Bug"
//   可以在 VSCode 里跑：Extension 只是它的一个 UI 前端
```

**收益**：
- Agent Runtime 可以独立测试（无需启动 VSCode）
- 可以同时支持 VSCode Extension / CLI / Web Dashboard 三个前端
- 未来可以云化部署（Agent Runtime 作为独立服务）

---

## 2. 技术栈（TypeScript-first，工业级）

### 2.1 完整技术栈矩阵

| 层 | 技术 | 为什么选它 | 学到什么 |
|----|------|-----------|---------|
| **编辑器宿主** | VSCode Extension API | 不重复造编辑器，专注差异化 | VSCode 扩展架构、Extension Host 进程模型 |
| **UI 框架** | React 19 + TypeScript 5.7+ | VSCode Webview 事实标准 | React 并发特性、Webview 通信协议 |
| **UI 组件** | Tailwind CSS + Radix UI | 轻量、无运行时开销、可访问性内置 | Utility-first CSS、Headless UI 模式 |
| **状态管理** | Zustand | 比 Redux 轻 10x，TS 类型推断完美 | Flux 模式的现代演进、immer 集成 |
| **构建工具** | esbuild + tsc | 极速构建（<100ms HMR） | Bundler 原理、ESM/CJS 互操作 |
| **包管理** | pnpm | 磁盘效率最高，monorepo 原生支持 | Workspace 协议、hard link 机制 |
| **Agent Runtime** | **TypeScript** (Node.js 22+) | 与 Claude Code 同栈，事件循环模型够用 | Node.js Streams、AsyncLocalStorage、Worker Threads |
| **Agent 循环** | AsyncGenerator + AbortController | 流式逐步骤输出，可取消 | JS 异步模式、Generator 在控制流中的应用 |
| **IPC 协议** | JSON-RPC 2.0 over Unix Socket | 结构化、可扩展、可观测 | RPC 协议设计、Unix Socket vs HTTP |
| **工具执行** | child_process + Worker Threads | 隔离执行，OS 能力透传 | Node.js 进程管理、沙箱机制 |
| **代码解析** | tree-sitter (WASM binding) | 多语言增量解析，VSCode 同款 | AST 解析原理、增量算法 |
| **全文搜索** | ripgrep (rg) 子进程 + 自定义 BM25 索引 | 工业级 Grep 性能 + 代码特化排序 | 倒排索引原理、TF-IDF/BM25 |
| **向量存储** | LanceDB (embedded) | 本地优先，零运维，支持增量写入 | 向量检索原理、ANN 索引 (IVF/HNSW) |
| **嵌入模型** | 本地 ONNX (BGE-M3) 或 API fallback | 代码语义理解，隐私优先 | Embedding 原理、ONNX 运行时 |
| **LSP 集成** | VSCode LSP Client API | 已有基础设施，不重新发明 | LSP 协议细节、语言智能 |
| **数据库** | better-sqlite3 | 零配置，同步 API（适合单机） | SQLite 原理、WAL 模式 |
| **配置系统** | Zod + JSON Schema | 类型安全配置，运行时校验 | Schema 驱动设计、类型推导 |
| **日志/遥测** | pino + OpenTelemetry | 结构化日志 + 分布式追踪 | 可观测性三大支柱（Log/Metric/Trace） |
| **测试** | Vitest + Playwright | 单测 + E2E，速度快 | 测试金字塔、Mock 策略 |
| **CI/CD** | GitHub Actions | 标准、免费 | CI 流水线设计 |
| **发布** | vsce (VSCode) + npm (CLI) | 各自生态标准 | 扩展市场发布流程 |

### 2.2 核心问题：Agent Runtime 用 TypeScript 够不够？

这是最关键的技术决策。Claude Code 用 TypeScript 做到了 100+ 步自主循环，证明了 TS 的可行性。

| 关注点 | TS 方案 | 结论 |
|--------|---------|------|
| **并发模型** | Event Loop + Worker Threads | Agent 的本质是"等待 LLM 响应"，不是 CPU 密集，Event Loop 完全够用 |
| **长时间运行** | AsyncGenerator + AbortController | 原生支持流式、可取消 |
| **工具并行** | Promise.all + Worker Threads | 多个工具可以并发执行 |
| **内存控制** | V8 GC + WeakRef + 主动释放 | 需要比 Go 更小心，但 Node.js 22 的 GC 已经足够好 |
| **性能关键路径** | Rust native addon（napi-rs） | 只在搜索/解析需要的地方用 Rust，不是全部 |
| **生态** | npm 最大生态 | 比 Go/Rust 都大 |

**结论**：TypeScript 做 Agent Runtime 完全够用。Claude Code 就是最佳证据。**只在性能关键路径上引入 Rust**（代码搜索、AST 解析、向量索引），其余全部 TypeScript。

### 2.3 Rust 的必要边界

```
TypeScript 不适合的地方（引入 Rust via napi-rs）:
  1. 代码全文搜索（BM25 索引 + 倒排）
     原因：大代码库（10K+ 文件）的倒排索引构建和查询，TS 实现会慢 5-10x
     方案：napi-rs 写 Rust 索引库，TS 侧通过 FFI 调用
  
  2. tree-sitter 增量解析
     原因：tree-sitter 本身就是 C/Rust，JS binding 存在但性能一般
     方案：Rust 封装 tree-sitter，TS 侧拿到序列化后的 AST JSON

  3. 向量相似度计算（可选）
     原因：HNSW/IVF 索引构建在 TS 中不够快
     方案：直接使用 LanceDB 内嵌（已用 Rust 实现）

Rust 代码量预估：< 5% 总体代码量
边界：Rust 只做"输入字节 → 输出结构化数据"的纯函数转换
```

---

## 3. Agent 系统设计（对标 Claude Code 的自主性）

### 3.1 Claude Code Agent Loop 的本质

Claude Code 的核心出奇简单——一个 while 循环：

```typescript
// Claude Code 的 Agent Loop 本质（简化版）
async function agentLoop(initialPrompt: string, tools: Tool[], context: Context) {
  let messages = [buildSystemPrompt(tools), { role: 'user', content: initialPrompt }];
  
  while (true) {
    const response = await llm.chat(messages, { tools });
    messages.push(response.message);
    
    if (response.message.tool_calls.length === 0) break;
    
    const results = await executeTools(response.message.tool_calls);
    messages.push(...results);
    
    // 上下文压缩检查
    if (tokenCount(messages) > THRESHOLD) {
      messages = await compactContext(messages);
    }
  }
  
  return messages;
}
```

**95% 的工程复杂度在这个循环之外**：
- 上下文压缩（wU2）
- 异步用户干预（h2A）
- 权限流水线
- 子 Agent 隔离
- 会话持久化
- 错误恢复

### 3.2 Cangjie Agent 架构（TypeScript 实现）

```
┌─────────────────────────────────────────────────────────┐
│                Agent Orchestrator (TypeScript)            │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Main Agent Loop                      │    │
│  │                                                 │    │
│  │  while (step < maxSteps && !aborted) {          │    │
│  │    // 1. Build prompt with tool definitions     │    │
│  │    // 2. Call LLM (streaming)                   │    │
│  │    // 3. If tool_calls → execute → append       │    │
│  │    // 4. If no tool_calls → return result       │    │
│  │    // 5. Check context → compact if needed       │    │
│  │    // 6. Check abort signal → exit gracefully    │    │
│  │  }                                               │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐    │
│  │           Stream Controller                      │    │
│  │  (AsyncGenerator + AbortController)              │    │
│  │                                                 │    │
│  │  yield { type: 'thinking', content: '...' }     │    │
│  │  yield { type: 'tool_call', tool: 'read_file' } │    │
│  │  yield { type: 'tool_result', data: '...' }     │    │
│  │  yield { type: 'response', content: '...' }     │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐    │
│  │           Dual Buffer (h2A pattern)             │    │
│  │                                                 │    │
│  │  Input Buffer:  user messages (可能中途插入)     │    │
│  │  Output Buffer: LLM responses (stream to UI)    │    │
│  │                                                 │    │
│  │  用户可以在 Agent 执行中注入新指令，不打断循环    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 3.3 核心 TypeScript 接口

```typescript
// packages/agent-runtime/src/types.ts

// ============================================================
// Agent Loop 类型
// ============================================================

/** Agent 执行的流式事件 */
export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string; duration: number }
  | { type: 'response'; content: string }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'compact'; reason: string }
  | { type: 'error'; error: AgentError }
  | { type: 'done'; summary: RunSummary };

/** Agent 执行器接口 */
export interface AgentRunner {
  /** 流式执行 Agent 任务 */
  run(input: AgentInput, signal?: AbortSignal): AsyncGenerator<AgentEvent>;
  /** 恢复暂停的会话 */
  resume(sessionId: string, signal?: AbortSignal): AsyncGenerator<AgentEvent>;
}

// ============================================================
// Tool 系统类型（对标 Claude Code 的工具集）
// ============================================================

/** 工具定义（JSON Schema） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** 工具的风险等级（影响权限检查行为） */
  risk: 'readonly' | 'write' | 'execute' | 'network';
  /** 是否需要用户确认 */
  requiresApproval: boolean;
}

/** 工具实现 */
export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** 工具执行上下文 */
export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  signal: AbortSignal;
  /** 权限检查器 */
  permission: PermissionChecker;
  /** 调用子 Agent */
  spawnTask: (prompt: string, options?: TaskOptions) => Promise<string>;
}

// ============================================================
// 上下文管理系统
// ============================================================

/** 上下文预算 */
export interface TokenBudget {
  maxTokens: number;         // 模型总 Token 限制
  systemPromptTokens: number; // 系统提示占用
  reserveTokens: number;     // 输出预留
  availableForHistory: number; // 可用于历史的 Token
}

/** 压缩策略 */
export type CompactionStrategy =
  | 'truncate-early'   // 截断最早的消息
  | 'summarize'        // LLM 总结早期对话
  | 'split-to-file'    // 写入文件，替换为文件引用
  | 'sub-agent';        // 启动子 Agent，只取结论

// ============================================================
// 权限系统（对标 Claude Code 的 Deny-First）
// ============================================================

export interface PermissionChecker {
  /** 检查工具调用权限 */
  check(tool: string, args: Record<string, unknown>): Promise<PermissionDecision>;
  /** 学习用户决策 */
  learn(tool: string, pattern: PermissionPattern, decision: PermissionDecision): Promise<void>;
}

export type PermissionDecision = 
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; message: string };
```

### 3.4 Agent Loop 实现（教育性完整代码）

```typescript
// packages/agent-runtime/src/agent-loop.ts

import { EventEmitter } from 'node:events';
import { tokenCount, compactMessages } from './context';
import { PermissionPipeline } from './permission';
import type { AgentRunner, AgentEvent, Tool, Message } from './types';

/**
 * Cangjie Agent Loop 实现
 * 
 * 设计理念（来自 Claude Code 的教训）：
 * 1. Keep it simple — 一个 while 循环，不做过度抽象
 * 2. 工具是 plain text — 工具的输入输出都是字符串，模型自己理解
 * 3. 上下文压缩是核心挑战 — 不是 prompt engineering
 * 4. 用户可以在任何时候介入 — h2A 双缓冲模式
 * 
 * 学习要点：
 * - AsyncGenerator 如何实现流式控制反转
 * - AbortController 如何优雅取消长任务
 * - Token 预算管理是 Agent 工程的第一难题
 */
export class CangjieAgent implements AgentRunner {
  constructor(
    private llm: LlmClient,
    private tools: Map<string, Tool>,
    private permission: PermissionPipeline,
    private contextManager: ContextManager,
  ) {}

  async *run(
    input: AgentInput,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const { messages, toolDefs, budget } = 
      await this.prepareRun(input);
    
    let step = 0;
    const MAX_STEPS = input.maxSteps ?? 100;

    while (step < MAX_STEPS) {
      // === 检查中断信号 ===
      if (signal?.aborted) {
        yield { type: 'error', error: new AgentError('Aborted by user') };
        break;
      }

      // === 上下文压缩检查（wU2 模式） ===
      const usage = tokenCount(messages);
      if (usage > budget.availableForHistory * 0.92) {
        yield { type: 'compact', reason: `Token usage ${usage}/${budget.availableForHistory}` };
        messages = await compactMessages(messages, this.llm);
      }

      // === LLM 调用（流式） ===
      const response = await this.llm.chat({
        messages,
        tools: toolDefs,
        max_tokens: budget.reserveTokens,
      });

      messages.push(response.message);

      // === 无工具调用 = 任务完成 ===
      if (!response.message.tool_calls?.length) {
        yield { type: 'response', content: response.message.content };
        yield { type: 'done', summary: { steps: step, tokens: usage } };
        break;
      }

      // === 执行工具调用（可并发） ===
      const results = await Promise.all(
        response.message.tool_calls.map(async (tc) => {
          // 1. 权限检查
          yield { type: 'tool_call', tool: tc.name, args: tc.args };
          
          const decision = await this.permission.check(tc.name, tc.args);
          if (decision.action !== 'allow') {
            return { role: 'tool', content: `Permission denied: ${decision.reason}` };
          }

          // 2. 执行工具
          const tool = this.tools.get(tc.name);
          if (!tool) return { role: 'tool', content: `Tool not found: ${tc.name}` };

          const startTime = Date.now();
          const result = await tool.execute(tc.args, {
            workspaceRoot: input.workspaceRoot,
            sessionId: input.sessionId,
            signal: signal!,
            permission: this.permission,
            spawnTask: (p) => this.spawnSubAgent(p, signal),
          });

          yield { 
            type: 'tool_result', 
            tool: tc.name, 
            result: result.content, 
            duration: Date.now() - startTime 
          };

          return { role: 'tool', content: result.content };
        })
      );

      messages.push(...results);
      step++;
    }
  }

  /**
   * 子 Agent 生成（对标 Claude Code 的 Task 工具）
   * 
   * 关键设计：子 Agent 拥有独立上下文
   *   - 父 Agent 只拿到"报告"（最终结果）
   *   - 子 Agent 可以"炸掉自己的上下文窗口"去搜索
   *   - 这保护了父 Agent 的上下文预算
   */
  private async spawnSubAgent(
    prompt: string,
    parentSignal?: AbortSignal,
  ): Promise<string> {
    const subAgent = new CangjieAgent(
      this.llm,
      new Map([...this.tools].filter(([name]) => 
        // 子 Agent 只能读，不能写（默认）
        !['write_file', 'edit_file', 'bash'].includes(name)
      )),
      this.permission,
      this.contextManager,
    );

    const events: AgentEvent[] = [];
    for await (const event of subAgent.run({ prompt, maxSteps: 20 }, parentSignal)) {
      events.push(event);
      if (event.type === 'done') return event.summary.result;
    }

    return 'Sub-agent completed without explicit result';
  }
}
```

### 3.5 工具集设计（对标 Claude Code + 增强）

```
Claude Code 工具        Cangjie 工具          增强点
───────────────────────────────────────────────────────────
Read              →     read_file            + LSP 符号定位
Glob              →     glob                 + 语义文件搜索
Grep              →     grep                 + 混合搜索（BM25+向量）
Write             →     write_file           + Prettier 格式化
Edit              →     edit_file            + Tree-sitter AST 校验
Bash              →     bash                 + 沙箱隔离
Task              →     task                 + 工作树隔离
WebSearch         →     web_search           同
WebFetch          →     web_fetch            同
TodoWrite         →     todo_write           同
—                 →     lsp_goto_def         ★ 新增：符号跳转
—                 →     lsp_find_refs        ★ 新增：引用查找
—                 →     search_code          ★ 新增：语义搜索
—                 →     run_test             ★ 新增：测试运行
—                 →     git_diff/stash       ★ 新增：Git 操作
```

**工具设计的核心原则**（来自 Claude Code 的教训）：

1. **Text in, text out** — 工具的输入输出都是字符串，不给模型结构化对象。原因：LLM 对纯文本的理解远好于复杂 JSON。
2. **Bash is universal** — Bash 是最强大的工具，模型能用它做任何事（写 Python 脚本、调 API、处理文件）。
3. **Edit, don't rewrite** — 用 diff 修改文件，不重写。原因：减少 Token 消耗 + 防止意外修改 + 人类审查友好。
4. **Grep > Embedding**（在 Agent 场景） — Agent 自己 grep 比预先 RAG 更准确（不会遗漏/过时）。

---

## 4. 代码智能系统（RAG + 混合搜索）

### 4.1 两种搜索范式

```
范式 A: 预计算 RAG（Cursor 模式）
  代码 → 切片 → Embedding → 向量库 → 用户查询 → 语义匹配 → 返回
  优势: 快（<100ms），语义理解强
  劣势: 索引可能过时，对精确匹配（函数名）弱

范式 B: 实时 Grep（Claude Code 模式）
  用户提问 → Agent 自己 grep/glob → 找到文件 → read → 分析
  优势: 始终最新，精确匹配强，模型可控
  劣势: 慢（需要多轮工具调用），依赖模型判断力

范式 C: 混合（Cangjie 模式）
  索引预计算（100ms 语义搜索）+ Agent 实时探索（grep/lsp）
  → Agent 自主选择最快的路径
```

### 4.2 混合搜索架构（TypeScript + Rust Bridge）

```typescript
// packages/code-intelligence/src/search-engine.ts

/**
 * 混合搜索引擎
 * 
 * 策略：
 * 1. 快速路径: BM25 全文检索（毫秒级，精确匹配）
 * 2. 语义路径: 向量相似度（语义理解，模糊匹配）
 * 3. 混合重排: Reciprocal Rank Fusion 合并两种结果
 * 4. 符号图: 利用 AST 符号图扩展上下文
 * 
 * 学习要点：
 * - BM25 算法原理（TF-IDF 的现代改进）
 * - 向量检索中的 ANN 近似算法（HNSW/IVF）
 * - RRF 融合排序（无需校准分数的排序融合）
 */
export class HybridSearchEngine {
  constructor(
    private fullText: FullTextIndex,  // Rust napi-rs 实现
    private vector: VectorIndex,      // LanceDB
    private symbols: SymbolGraph,     // tree-sitter AST 图
  ) {}

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const [bm25Results, vectorResults] = await Promise.all([
      this.fullText.search(query, { topK: options.topK ?? 20 }),
      this.vector.search(query, { topK: options.topK ?? 20 }),
    ]);

    // RRF (Reciprocal Rank Fusion)
    return this.rerank(bm25Results, vectorResults, options);
  }

  /**
   * 上下文扩展：不仅返回匹配文件，还返回：
   * 1. 被调用函数（下游依赖）
   * 2. 调用者（上游依赖）
   * 3. 同模块文件
   */
  async expandContext(results: SearchResult[]): Promise<ExpandedContext> {
    const symbols = await this.symbols.resolveReferences(
      results.map(r => r.symbolId).filter(Boolean)
    );
    return { results, relatedSymbols: symbols };
  }
}
```

### 4.3 索引构建流程

```
Workspace Changed (onDidChangeWorkspaceFolders)
      │
      ▼
  File Walker（增量：仅处理变更文件）
      │
      ├──→ tree-sitter Parse ──→ AST Symbol Index
      │                              │
      │   (Rust napi-rs)             └──→ Symbol Graph（调用关系图）
      │
      ├──→ Code Chunking（按函数/类边界）
      │         │
      │         ├──→ BM25 Full-Text Index（Rust Tantivy binding）
      │         └──→ Embedding（本地 ONNX 或 API）→ LanceDB
      │
      └──→ Merkle Tree（增量同步检测）
               │
               └──→ 仅变更文件重索引，其余复用
```

### 4.4 为什么不用纯向量搜索（Claude Code 的关键教训）

> "Grep matches how human developers actually search codebases."
> — Claude Code 团队

| 搜索类型 | 适合什么 | 不适合什么 | Cangjie 策略 |
|----------|---------|-----------|-------------|
| **Grep/Glob** | 函数名、文件路径、错误信息 | "认证逻辑在哪" | 第一步（精确快速） |
| **BM25** | 关键词 + 代码结构匹配 | "类似功能的实现" | 默认搜索引擎 |
| **Vector** | 语义相似、"类似XX的功能" | 精确匹配（类名、函数名） | 语义回退（当 Grep 结果为空时） |
| **LSP** | 跳转定义、查找引用、类型信息 | 跨文件理解 | 上下文扩展（辅助搜索） |
| **Symbol Graph** | 调用链、影响分析 | 非结构化查询 | 关系推理 |

**关键设计**：Agent 有所有工具的访问权，自己决定用什么。这是 Claude Code 的核心哲学——不给模型预选结果，而是给它工具让它自己找。

---

## 5. 上下文工程（Context Engineering）

### 5.1 这是 Agent 工程的第一难题

Claude Code 团队的原话：
> "Context management, not prompt engineering, is the primary engineering challenge."

为什么上下文比 Prompt 重要：

| 问题 | 根因 | 解 |
|------|------|-----|
| Agent 在第 30 步后"忘记"最初目标 | 早期消息被注意力机制稀释 | 压缩 + TodoWrite 追踪 |
| 上下文窗口被无关搜索结果填满 | 搜索结果没做信息密度筛选 | 搜索结果摘要化，只保留关键 |
| 模型在不相关的文件上浪费时间 | 上下文缺乏导航信息 | 注入项目结构概览 |
| 200K 窗口够大但在 100K 时性能已退化 | 长上下文的注意力稀释 | 在 70% 时触发压缩 |

### 5.2 Token 预算分配

```
200K Token 窗口分配策略：

┌──────────────────────────────────────────┐
│ System Prompt           ~5K  (固定)       │  模型行为定义 + 工具描述
│ Project Structure       ~3K  (固定)       │  目录树 + 关键文件概览
│ User Guide / Memory     ~5K  (半固定)     │  .cangjie/memory + CLAUDE.md
│ Search Results          ~30K (动态上限)   │  每次搜索返回的信息量
│ Conversation History    ~100K (动态)      │  随着对话增长
│ Output Reserve          ~57K (预留)       │  模型输出空间
└──────────────────────────────────────────┘
```

### 5.3 5 层上下文压缩（参考 Claude Code wU2）

```typescript
// packages/agent-runtime/src/context/compaction.ts

/**
 * 5 阶段上下文压缩策略
 * 
 * 学习要点：
 * - 为什么不在 100% 时才压缩（性能已在 70%+ 恶化）
 * - 压缩不是"删除"，是"用更少 Token 表达相同信息"
 * - 不同阶段用不同策略（截断 vs 摘要 vs 分拆）
 */
export const COMPACTION_STRATEGIES = {
  /** 阶段 1: 每条消息大小限制（始终生效） */
  budgetControl: (msg: Message, maxSize: number) => {
    if (msg.content.length > maxSize) {
      return { ...msg, content: msg.content.slice(0, maxSize) + '\n... [truncated]' };
    }
    return msg;
  },

  /** 阶段 2: Token > 70% — 修剪早期工具结果 */
  snip: (messages: Message[]) => {
    // 保留最近 N 轮的完整内容，更早的只保留摘要
    const recent = messages.slice(-20);
    const old = messages.slice(0, -20);
    return [...summarizeOldResults(old), ...recent];
  },

  /** 阶段 3: Token > 85% — 模型总结早期对话 */
  compact: async (messages: Message[], llm: LlmClient) => {
    const toCompact = messages.slice(0, Math.floor(messages.length * 0.5));
    const toKeep = messages.slice(Math.floor(messages.length * 0.5));
    const summary = await llm.summarize(toCompact);
    return [{ role: 'system', content: `[Previous conversation summary: ${summary}]` }, ...toKeep];
  },

  /** 阶段 4: Token > 92% — 虚拟投影（非破坏性） */
  collapse: (messages: Message[]) => {
    // 使用更激进的截断，但不"忘记"——记录检查点
    return messages; // 实际实现更复杂
  },

  /** 阶段 5: Token > 95% — 全量压缩（最后手段） */
  autoCompact: async (messages: Message[], llm: LlmClient, session: Session) => {
    // 强制总结 + 保存到文件 + 开始新的上下文
    return []; // 实际实现更复杂
  },
};
```

### 5.4 Memory 系统（持久化跨会话记忆）

```
Session Memory（当前会话）
  ┌──────────────────────────────┐
  │ 消息历史 + 压缩摘要          │ → 会话结束时可选择保存/丢弃
  └──────────────────────────────┘

Project Memory（项目级，.cangjie/memory/）
  ┌──────────────────────────────┐
  │ 项目约定、用户偏好、架构决策  │ → 每次会话自动注入 System Prompt
  │ 类似 Claude Code 的 CLAUDE.md │
  └──────────────────────────────┘

Knowledge Memory（代码知识库，自动维护）
  ┌──────────────────────────────┐
  │ 代码索引 + 符号图 + 向量库   │ → 随代码变更自动更新
  │ 可重建，不需要手动维护        │
  └──────────────────────────────┘

User Memory（用户级，~/.cangjie/）
  ┌──────────────────────────────┐
  │ 跨项目偏好、常用工具配置     │ → 类似 Claude Code 的全局 CLAUDE.md
  │ 语言、风格、权限偏好         │
  └──────────────────────────────┘
```

---

## 6. IDE UX 层设计（对标 Cursor 体验）

### 6.1 Cursor vs Claude Code 的 UX 差距

这是 Cangjie 最大的差异化机会——把 Claude Code 的 Agent 能力装进 Cursor 的图形界面：

| 操作 | Claude Code (终端) | Cursor | Cangjie (目标) |
|------|-------------------|--------|---------------|
| **代码修改** | Markdown diff 文本 | Inline Diff + Accept/Reject 按钮 | **Inline Diff + 逐块审查** |
| **搜索代码** | Grep 终端输出 | 侧边栏结果列表 + 点击跳转 | **混合搜索面板 + 实时预览** |
| **Agent 状态** | "Thinking..." 旋转 | 无 Agent 概念 | **可视化 Plan→Execute→Verify 流程** |
| **文件操作** | 终端文字 | 文件树 + Tab | **文件树 + 实时同步** |
| **子任务** | 不可见 | 无 | **子 Agent 状态树 + 进度** |
| **上下文** | 不可见 | 不可见 | **Token 用量仪表盘** |
| **中断/介入** | Ctrl+C 全停 | 无 | **优雅中断 + 部分成果保留** |

### 6.2 交互通道

```
┌──────────────────────────────────────────────────┐
│              Cangjie VSCode Extension              │
│                                                  │
│  ① Chat Panel（对话面板）                          │
│     └─ 主对话界面，流式 Markdown，Agent 步骤可视化  │
│                                                  │
│  ② Inline Edit（行内编辑）                         │
│     └─ Cmd+K 触发，选中区域重构，Ghost Text 预览    │
│                                                  │
│  ③ Diff Review（差异审查）                         │
│     └─ 侧边栏，逐文件 diff，Accept/Reject/Split    │
│                                                  │
│  ④ Agent Panel（Agent 面板）                      │
│     └─ 实时显示 Agent 的 Plan / Current Step / Todo │
│                                                  │
│  ⑤ Search Panel（搜索面板）                        │
│     └─ 混合搜索结果，代码预览，一键跳转             │
│                                                  │
│  ⑥ Terminal Panel（终端面板）                      │
│     └─ Agent 可以操作终端，用户可见可干预           │
└──────────────────────────────────────────────────┘
```

### 6.3 状态管理架构（Zustand）

```typescript
// packages/ide-extension/src/stores/agent-store.ts

import { create } from 'zustand';
import type { AgentEvent } from '@cangjie/agent-runtime';

/**
 * Agent 状态管理
 * 
 * 设计要点：
 * 1. 单一 Store（不是多个），因为 Agent 状态是全局的
 * 2. 不可变更新（immer 集成）
 * 3. 与 Agent Runtime 通过 AsyncGenerator 事件流通信
 * 
 * 学习要点：
 * - Zustand 的不可变更新模式
 * - Event-driven state 的设计
 * - Webview ↔ Extension Host 的状态同步
 */
interface AgentState {
  // 会话
  sessionId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;

  // Agent 执行状态
  currentStep: number;
  plan: PlanStep[];
  todoItems: TodoItem[];
  toolCalls: ToolCallStatus[];

  // UI 状态
  activePanel: 'chat' | 'agent' | 'search' | 'diff';
  diffChanges: FileChange[];
  
  // Actions
  sendMessage: (content: string) => Promise<void>;
  abortAgent: () => void;
  acceptDiff: (changeId: string) => void;
  rejectDiff: (changeId: string) => void;
  updatePlanStep: (stepId: string, status: PlanStep['status']) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // ... implementation
}));
```

---

## 7. 数据流（一次完整的 Agent 请求）

```
User: "@cmd+k 修复 auth.ts 里的登录 Bug，写测试验证"
              │
              ▼
┌─────────────────────────────────────────────────┐
│ ① UX Coordinator：识别为 Agent 请求              │
│   路由到 Agent Channel（不是 Tab Complete 快通道）│
└──────────────────────┬──────────────────────────┘
                       │ JSON-RPC
                       ▼
┌──────────────────────────────────────────────────┐
│ ② Context Engine：收集上下文                      │
│                                                  │
│   1. 当前打开文件（auth.ts）—— 编辑器状态           │
│   2. search_code("login bug auth") —— 混合搜索     │
│   3. lsp_find_refs("login") —— LSP 引用            │
│   4. read_file("auth.test.ts") —— 已有测试          │
│   5. read_file(".cangjie/memory/architecture.md")  │
│   6. git diff —— 最近的变更                        │
│                                                  │
│   结果：40K Token 的精选上下文                      │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│ ③ Agent Runtime：启动 Agent Loop                  │
│                                                  │
│   Step 1: Model → Plan                            │
│     "我需要：① 搜索 login 相关代码找到 Bug         │
│              ② 分析根因                           │
│              ③ 修复                               │
│              ④ 写/跑测试验证"                      │
│     → todo_write(items)                           │
│                                                  │
│   Step 2: Model → Tool Calls                      │
│     grep("login", auth.ts) → 找到 login() 函数     │
│     grep("token refresh", auth.ts) → 定位可疑代码   │
│     read_file(auth.ts#L120-L150) → 读取 Bug 区域    │
│                                                  │
│   Step 3: Model → Analysis                        │
│     "发现 token 刷新逻辑的时间比较使用了            │
│      Date.now() 而不是服务器时间，导致时区问题"      │
│                                                  │
│   Step 4: Model → Tool Calls                      │
│     edit_file(auth.ts, diff: ...) → 修复           │
│     write_file(auth.test.ts, ...) → 写测试          │
│                                                  │
│   Step 5: Model → Tool Calls                      │
│     bash("npm test -- auth.test.ts") → 测试通过 ✓   │
│     todo_write(update: all done)                   │
│                                                  │
│   Step 6: Model → Response                        │
│     "修复完成。根因是... 变更：..."                  │
│                                                  │
└──────────────────────┬───────────────────────────┘
                       │ AgentEvent stream
                       ▼
┌──────────────────────────────────────────────────┐
│ ④ UX 展示                                        │
│                                                  │
│   Chat Panel: Agent 思考过程和总结                 │
│   Diff Review: 显示 auth.ts 的修改                 │
│     ┌────────────────────────────────────┐       │
│     │ @@ -123,5 +123,5 @@                │       │
│     │ - const now = Date.now()           │       │
│     │ + const now = serverTime.now()     │       │
│     │                                    │       │
│     │ [Accept] [Reject]                  │       │
│     └────────────────────────────────────┘       │
│   Agent Panel: 5/5 steps 完成 ✓                   │
└──────────────────────────────────────────────────┘
```

---

## 8. 子 Agent 与多 Agent 编排

### 8.1 Claude Code 的子 Agent 教训

Claude Code 最初设计子 Agent 是为了并行工作，但发现子 Agent 更大的价值是：

1. **上下文隔离**：子 Agent 可以"炸掉自己的上下文"去搜索，只给父 Agent 结论
2. **角色专门化**：Explore Agent / Plan Agent / Verify Agent 各有专门的工具集
3. **独立权限**：子 Agent 只能读（默认），写操作需要父 Agent 授权

### 8.2 Cangjie 的子 Agent 类型

```typescript
// packages/agent-runtime/src/sub-agents/types.ts

export enum SubAgentType {
  /** 探索型: 只读，大规模搜索，返回报告 */
  EXPLORE = 'explore',
  
  /** 计划型: 分析问题，分解任务，返回执行计划 */
  PLAN = 'plan',
  
  /** 验证型: 检查修改效果，运行测试，返回验证报告 */
  VERIFY = 'verify',
  
  /** 执行型: 在隔离环境执行修改（Worktree / Sandbox） */
  EXECUTE = 'execute',
}

/** 子 Agent 配置 */
export interface SubAgentConfig {
  type: SubAgentType;
  tools: string[];          // 可用的工具列表
  maxSteps: number;         // 最大执行步数
  isolation: 'in-process' | 'worktree' | 'sandbox';
  timeout: number;          // 超时（毫秒）
}
```

---

## 9. 插件与可扩展性

### 9.1 扩展体系（从低到高上下文成本）

| 机制 | 上下文成本 | 实现方式 | 对标 |
|------|-----------|---------|------|
| **Hooks** | 零 | 事件驱动，Tool Call 前后执行自定义脚本 | Claude Code Hooks |
| **Skills** | 低（按需加载 SKILL.md） | 专业能力文件，模型自己决定是否加载 | Claude Code Skills |
| **Commands** | 低 | `/review` `/test` 等快捷命令 | Custom slash commands |
| **MCP Servers** | 高 | 标准 MCP 协议接入外部工具 | Claude Code MCP |
| **Plugins** | 中 | Command + Skill + MCP 的组合包 | VS Code Extension |

### 9.2 LSP 作为一等工具（Cangjie 差异化）

```
传统 Agent:         Cangjie Agent:
  LLM                LLM
   │                  │
   ├─ grep            ├─ grep
   ├─ read            ├─ lsp_goto_def   ★ 精确跳转
   ├─ bash            ├─ lsp_find_refs  ★ 查找引用
   └─ ...             ├─ lsp_hover      ★ 类型信息
                      ├─ lsp_diagnostics ★ 错误诊断
                      ├─ read
                      ├─ bash
                      └─ ...
```

**关键**：Agent 可以直接调 LSP 获取代码智能，不需要"猜测"符号位置。这比 Cursor 和 Claude Code 都更进一步——两者都没有让 Agent 主动调用 LSP。

---

## 10. 权限与安全

### 10.1 6 层防御（参考 Claude Code 模型）

```
Tool Call 到达
      │
Layer 1: 输入净化
  ├─ 命令注入检测（backticks, $(...), eval）
  ├─ 路径遍历检测（../, /etc/passwd）
  └─ 拒绝的请求直接返回 error
      │
Layer 2: 风险分级
  ├─ readonly  → 自动通过
  ├─ write     → 检查文件策略
  ├─ execute   → 检查 Shell 策略
  └─ network   → 检查域名白名单
      │
Layer 3: Hook Pipeline（自定义检查）
  ├─ .cangjie/hooks/ 目录下的脚本
  └─ 任何 Hook 返回 deny → 拒绝
      │
Layer 4: 权限规则引擎
  ├─ .cangjie/permissions.json
  └─ 支持 glob 模式匹配文件路径
      │
Layer 5: 用户交互确认
  ├─ 显示即将执行的命令/修改的 diff
  └─ Allow / Deny / Always Allow / Always Deny
      │
Layer 6: 审计日志
  ├─ 所有决策记录到 SQLite
  └─ 支持事后审查和回滚
```

### 10.2 权限是不可绕过的代码路径

```typescript
// packages/agent-runtime/src/permission/pipeline.ts

/**
 * 权限 Pipeline
 * 
 * 关键设计：权限检查是 Agent Loop 的独立代码路径
 * 即使 LLM 被 jailbreak，它也只能调用 executeTool()
 * 而 executeTool() 永远先检查权限，再执行
 * 
 * 学习要点：
 * - Fail-closed 原则（默认拒绝）
 * - 纵深防御（不是单层检查）
 * - 权限与模型完全解耦（模型不知道权限逻辑）
 */
export class PermissionPipeline implements PermissionChecker {
  private layers: PermissionLayer[] = [
    new InputSanitizer(),
    new RiskClassifier(),
    new HookRunner(),
    new PolicyEngine(),
  ];

  async check(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
    for (const layer of this.layers) {
      const decision = await layer.evaluate(tool, args);
      if (decision.action === 'deny') {
        this.auditLog.record({ tool, args, decision, layer: layer.name });
        return decision; // 任何一层拒绝，立即返回
      }
    }
    return { action: 'allow' };
  }
}
```

---

## 11. IPC 通信协议

### 11.1 VSCode Extension ↔ Agent Runtime

```
┌──────────────────────┐          ┌──────────────────────┐
│  VSCode Extension    │ JSON-RPC │  Agent Runtime       │
│  (Extension Host)    │◄────────►│  (Child Process)     │
│                      │  Unix    │                      │
│  - UI / Webview      │  Socket  │  - Agent Loop        │
│  - Editor API        │          │  - Tool Execution    │
│  - File Watcher      │          │  - Context Manager   │
└──────────────────────┘          └──────────────────────┘
```

```typescript
// packages/ipc/src/protocol.ts

/**
 * Cangjie IPC 协议定义（JSON-RPC 2.0）
 * 
 * 为什么用 JSON-RPC 而不是 gRPC/tRPC：
 * 1. JSON-RPC 是无依赖的标准，任何语言都能实现
 * 2. Unix Socket 保证性能（本地进程通信 <1ms 延迟）
 * 3. 简单：只有 request/notification/response 三种消息
 * 
 * 学习要点：
 * - JSON-RPC 2.0 规范
 * - Unix Socket vs HTTP 的选择
 * - 流式传输的 NDJSON 模式
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Agent 事件流使用 NDJSON（Newline-Delimited JSON）
// 每个 AgentEvent 序列化为一行 JSON，通过 Unix Socket 流式传输
```

---

## 12. 项目结构（Monorepo）

```
cangjie/
├── packages/
│   ├── agent-runtime/          # Agent 核心运行时（TypeScript）
│   │   ├── src/
│   │   │   ├── agent-loop.ts       # 主循环
│   │   │   ├── tools/              # 工具系统
│   │   │   │   ├── read-file.ts
│   │   │   │   ├── write-file.ts
│   │   │   │   ├── edit-file.ts
│   │   │   │   ├── bash.ts
│   │   │   │   ├── grep.ts
│   │   │   │   ├── glob.ts
│   │   │   │   ├── task.ts         # 子 Agent
│   │   │   │   ├── web-search.ts
│   │   │   │   ├── web-fetch.ts
│   │   │   │   ├── todo-write.ts
│   │   │   │   ├── lsp-navigate.ts
│   │   │   │   └── search-code.ts
│   │   │   ├── context/            # 上下文管理
│   │   │   │   ├── token-budget.ts
│   │   │   │   ├── compaction.ts
│   │   │   │   └── context-assembler.ts
│   │   │   ├── permission/         # 权限系统
│   │   │   │   ├── pipeline.ts
│   │   │   │   ├── policy.ts
│   │   │   │   └── audit.ts
│   │   │   ├── memory/             # 记忆系统
│   │   │   │   ├── session-memory.ts
│   │   │   │   ├── project-memory.ts
│   │   │   │   └── user-memory.ts
│   │   │   ├── sub-agents/         # 子 Agent
│   │   │   │   ├── types.ts
│   │   │   │   ├── explore.ts
│   │   │   │   ├── plan.ts
│   │   │   │   └── verify.ts
│   │   │   ├── session/            # 会话管理
│   │   │   │   ├── store.ts        # SQLite
│   │   │   │   ├── checkpoint.ts
│   │   │   │   └── compression.ts
│   │   │   └── llm/                # LLM 网关
│   │   │       ├── client.ts
│   │   │       ├── streaming.ts
│   │   │       └── providers/      # Anthropic / OpenAI / Gemini
│   │   ├── test/
│   │   └── package.json
│   │
│   ├── code-intelligence/     # 代码智能（TypeScript + Rust napi-rs）
│   │   ├── src/
│   │   │   ├── index.ts            # 入口
│   │   │   ├── search-engine.ts    # 混合搜索引擎
│   │   │   ├── full-text/          # 全文检索
│   │   │   │   ├── index.ts        # 调用 Rust native addon
│   │   │   │   └── bm25.ts
│   │   │   ├── vector/             # 向量检索
│   │   │   │   ├── lancedb.ts
│   │   │   │   └── embedding.ts    # ONNX / API
│   │   │   ├── parser/             # 代码解析
│   │   │   │   ├── tree-sitter.ts  # 调用 Rust native addon
│   │   │   │   └── chunker.ts
│   │   │   └── symbol-graph.ts     # 符号关系图
│   │   ├── native/                 # Rust napi-rs 代码
│   │   │   ├── Cargo.toml
│   │   │   ├── src/
│   │   │   │   ├── lib.rs
│   │   │   │   ├── full_text.rs    # BM25 + 倒排索引
│   │   │   │   └── parser.rs       # tree-sitter 封装
│   │   │   └── build.rs
│   │   └── package.json
│   │
│   ├── ide-extension/         # VSCode 插件（TypeScript）
│   │   ├── src/
│   │   │   ├── extension.ts        # 插件入口
│   │   │   ├── webview/            # React Webview
│   │   │   │   ├── App.tsx
│   │   │   │   ├── panels/
│   │   │   │   │   ├── ChatPanel.tsx
│   │   │   │   │   ├── DiffReview.tsx
│   │   │   │   │   ├── AgentPanel.tsx
│   │   │   │   │   └── SearchPanel.tsx
│   │   │   │   ├── components/
│   │   │   │   │   ├── Markdown.tsx
│   │   │   │   │   ├── DiffInline.tsx
│   │   │   │   │   ├── TokenUsage.tsx
│   │   │   │   │   └── AgentSteps.tsx
│   │   │   │   └── stores/
│   │   │   │       └── agent-store.ts
│   │   │   ├── services/           # Agent Runtime 客户端
│   │   │   │   └── agent-client.ts
│   │   │   └── commands/           # VSCode 命令注册
│   │   │       ├── chat.ts
│   │   │       ├── inline-edit.ts
│   │   │       └── agent.ts
│   │   └── package.json
│   │
│   ├── cli/                   # CLI 工具（TypeScript）
│   │   ├── src/
│   │   │   ├── main.ts             # `cj` 命令入口
│   │   │   ├── tui/                # 终端 UI（可选，Ink/React）
│   │   │   └── commands/           # 子命令
│   │   └── package.json
│   │
│   ├── ipc/                   # IPC 协议定义（共享包）
│   │   ├── src/
│   │   │   ├── protocol.ts
│   │   │   ├── server.ts           # Unix Socket Server
│   │   │   └── client.ts           # Unix Socket Client
│   │   └── package.json
│   │
│   └── shared/                # 共享类型和工具
│       ├── src/
│       │   ├── types.ts
│       │   ├── config.ts           # Zod Schema
│       │   └── utils.ts
│       └── package.json
│
├── docs/                      # 文档
│   ├── cangjie-design.md          # 本文档
│   └── upgrade-roadmap.md
│
├── .github/                   # CI/CD
│   └── workflows/
│       ├── ci.yml
│       └── publish.yml
│
├── pnpm-workspace.yaml        # Monorepo 配置
├── package.json               # Root
├── tsconfig.json              # Shared TS config
├── .cangjie/                  # Cangjie 自身配置
│   └── memory/
├── README.md
└── LICENSE
```

---

## 13. 开发路线图

### Phase 1：MVP（4 周）— "能对话的 VSCode 插件"

```
Week 1-2: 基础设施搭建
  - pnpm monorepo 初始化
  - VSCode Extension 骨架（extension.ts + Webview）
  - packages/shared + packages/ipc 协议定义
  - LLM 接入（Claude API streaming）

Week 3-4: 基础 Agent + Chat
  - packages/agent-runtime: Agent Loop 核心
  - 首批工具：read_file / grep / glob / write_file / edit_file
  - Chat Panel（React + Markdown 渲染）
  - 流式输出
```

### Phase 2：Agent Core（4 周）— "能自主执行的 Agent"

```
Week 5-6: 完整 Agent 能力
  - Tool System 完整实现（bash / task / web_search / todo_write）
  - Permission Pipeline
  - Context Manager（Token 预算 + 压缩）

Week 7-8: IDE 体验
  - Diff Review 面板（逐文件，Accept/Reject）
  - Agent Panel（Plan / Steps / Progress 可视化）
  - 子 Agent 支持
```

### Phase 3：Code Intelligence（4 周）— "真正理解代码"

```
Week 9-10: 代码解析 + 全文索引
  - Rust native addon: tree-sitter 多语言解析 + AST 索引
  - Rust native addon: BM25 全文索引
  - 增量索引（Merkle Tree）

Week 11-12: 语义搜索
  - LanceDB 集成 + 向量嵌入（本地 ONNX）
  - 混合搜索 + RRF 重排
  - Search Panel UI
```

### Phase 4：IDE 深度集成（4 周）— "Cursor 级体验"

```
Week 13-14: 交互增强
  - Tab 内联补全（Ghost Text + <500ms）
  - Inline Edit (Cmd+K)
  - LSP 作为 Agent 工具

Week 15-16: 记忆 + 打磨
  - Memory 系统（.cangjie/memory/）
  - Project Context 自动构建
  - 性能优化 + 错误恢复
```

### Phase 5：Scale & 开源（持续）

```
  - MCP Server 支持
  - Plugin 体系
  - 多模型适配
  - 开源社区运营
  - 文档 + 官网
```

---

## 14. 关键设计决策记录

### 14.1 为什么 TypeScript 主导而不是 Go

- **学习价值**：TS 生态是前端/全栈工程师的母语，降低贡献门槛
- **工业证据**：Claude Code（TS 单体）证明了 TS 能做生产级 Agent
- **VSCode 生态**：Extension 必须用 TS/JS，用 Go 需要额外的 IPC 层
- **Rust 的边界**：只在性能关键路径（搜索、解析）用 Rust，代码量 < 5%

### 14.2 为什么不 Fork VS Code 做独立 IDE

Cursor Fork VS Code 是 2021 年的选择。2026 年更好的策略：
- 不需要维护编辑器 Fork（巨大的技术债务）
- Extension 可同时支持 VSCode / Cursor / Windsurf / Code OSS
- Agent Runtime 独立进程，未来可云化部署
- 如果未来需要独立 IDE，Agent Runtime 可以直接嵌入

### 14.3 为什么本地优先而不是云端

- **Privacy-first**：代码是公司核心资产，不应上传
- **低延迟**：本地搜索 <100ms，云端搜索 >200ms（网络延迟）
- **离线可用**：Agent 应该在没有网络时也能工作（至少部分）
- **Cursor 的教训**：Cursor 把索引放云端已经引发大量隐私争议

### 14.4 为什么混合搜索而不是纯向量搜索

- Claude Code 只用 Grep——模型用 Grep 比 RAG 更准确（因为模型知道自己在找什么）
- Cursor 用 RAG——预计算使响应更快
- Cangjie 混合：给 Agent 所有工具，让它自己选择。快速路径用 BM25/Grep，语义需求用向量。

---

## 15. 核心指标

| 指标 | MVP 目标 | 理想态目标 | 测量方法 |
|------|---------|-----------|---------|
| Chat 首 Token | < 2s | < 1s | streaming first chunk |
| Agent 任务完成率 | > 60% | > 85% | SWE-bench / 自定义 Benchmark |
| 代码搜索延迟（10K files） | < 500ms | < 100ms | benchmark suite |
| 索引构建（10K files） | < 60s | < 30s | 首次全量索引 |
| 增量索引（1 file change） | < 500ms | < 200ms | 文件变更触发 |
| 内存占用（idle） | < 200MB | < 100MB | 不含 VSCode |
| 支持语言（tree-sitter） | 5 | 20+ | 按需添加 |
| 扩展启动时间 | < 1s | < 500ms | cold start |

---

## 16. 对标总结

```
                   Cursor    Claude Code   Cangjie (目标)
─────────────────────────────────────────────────────
IDE 体验            ★★★★★       ★★☆☆☆        ★★★★★
Agent 自主性        ★★★☆☆       ★★★★★        ★★★★★
代码理解（搜索）     ★★★★★       ★★★☆☆        ★★★★★
上下文工程           ★★★★☆       ★★★★★        ★★★★★
可扩展性             ★★★☆☆       ★★★★★        ★★★★★
权限安全             ★★★☆☆       ★★★★★        ★★★★★
本地优先/隐私        ★★★★☆       ★★★★★        ★★★★★
多模型支持           ★★★☆☆       ★★★☆☆        ★★★★★
开源                 ✗           ✗             ★★★★★
─────────────────────────────────────────────────────
```

**目标**：在每一行不低于两者中的最高分。在 IDE 体验上对标 Cursor，在 Agent 能力上对标 Claude Code，在搜索上超越两者，并且**开源**。

---

## 17. 发布与交付

### 17.1 阶段一：VSCode 插件发布

```bash
# 1. 安装发布工具
npm i -g @vscode/vsce

# 2. 注册 Publisher（一次性）
#    去 https://marketplace.visualstudio.com/manage
#    用 Microsoft 账号创建 Publisher ID，比如 "cangjie"

# 3. 本地打包测试
vsce package          # 输出 cangjie-x.x.x.vsix
code --install-extension cangjie-x.x.x.vsix

# 4. 发布到市场
vsce publish          # 几分钟后全球可用

# 5. 版本更新
#    package.json 改 version → vsce publish
```

**package.json 关键字段**：

```json
{
  "name": "cangjie",
  "displayName": "Cangjie - 代码智能体",
  "description": "AI 原生代码智能平台 — VSCode 里的自主代码 Agent",
  "publisher": "cangjie",
  "version": "0.1.0",
  "icon": "assets/icon.png",
  "repository": "https://github.com/wzhongyou/cangjie",
  "categories": ["Programming Languages", "Machine Learning", "Other"],
  "keywords": ["ai", "agent", "code", "claude", "cursor"],
  "engines": { "vscode": "^1.90.0" },
  "activationEvents": [],
  "main": "./dist/extension.js"
}
```

**CI 自动发布（GitHub Actions）**：

```yaml
# .github/workflows/publish-vscode.yml
name: Publish VSCode Extension
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install && pnpm build
      - run: pnpm -C packages/vscode-extension vsce publish -p ${{ secrets.VSCE_TOKEN }}
```

### 17.2 阶段二：独立桌面 App 发布（macOS / Windows / Linux）

独立 App 使用 Electron + Monaco，发布用 electron-builder：

```bash
# packages/desktop/ 下
pnpm build:desktop    # 输出到 dist/
  ├── Cangjie-0.5.0-arm64.dmg        (macOS Apple Silicon)
  ├── Cangjie-0.5.0-x64.dmg          (macOS Intel)
  ├── Cangjie Setup 0.5.0.exe       (Windows)
  └── cangjie_0.5.0_amd64.deb       (Linux)
```

**macOS 特有**：代码签名 + 公证（否则 Gatekeeper 拦截）

```bash
# 签名
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name (TEAM_ID)" \
  dist/mac-arm64/Cangjie.app

# 公证
xcrun notarytool submit Cangjie-0.5.0-arm64.dmg \
  --apple-id your@email.com --team-id TEAM_ID --wait

# 装订公证票据（离线验证）
xcrun stapler staple Cangjie-0.5.0-arm64.dmg
```

---

## 18. 学习路径（跟着这个项目你能学到什么）

| 模块 | 学到的知识 |
|------|-----------|
| **Agent Loop** | 异步流程控制、Generator/AsyncGenerator、流式处理、状态机 |
| **Tool System** | 插件架构、安全沙箱、子进程管理、权限模型 |
| **Context Engineering** | Token 预算、文本压缩策略、Prompt 构建 |
| **Code Intelligence** | BM25/倒排索引、向量检索/HNSW、tree-sitter AST、LSP 协议 |
| **IPC** | JSON-RPC 2.0、Unix Socket、Protocol Buffers、流式协议 |
| **VSCode Extension** | Extension Host 进程模型、Webview 通信、Editor API |
| **React in Webview** | 受限环境下的状态管理、虚拟 DOM diff、Tailwind 设计系统 |
| **Rust + TypeScript** | napi-rs FFI、Native Addon 构建、跨语言内存管理 |
| **Monorepo** | pnpm workspace、依赖管理、构建编排、版本策略 |
| **安全** | Fail-closed 设计、纵深防御、审计日志、沙箱隔离 |
| **测试** | Agent 行为测试、工具集成测试、E2E（Playwright） |
| **CI/CD** | GitHub Actions、自动化发布、版本管理 |

---

*最后更新：2026-06-07*
*作者：Cangjie Team*

> **设计哲学**（来自 Claude Code 的核心教训）：
> "Less scaffolding, more model. Simple is better than complex. Give it tools and get out of the way."
