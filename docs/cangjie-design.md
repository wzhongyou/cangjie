# Cangjie（仓颉）设计文档

> **做最好的 TUI Coding Agent**
>
> TypeScript + Bun + Ink | MIT | v0.2.0

### 实现状态

| 模块 | 状态 |
|------|------|
| Agent Loop + 10 工具 + 多模型 | ✅ v0.2 |
| Ink TUI + 命令系统 + 权限确认 | ✅ v0.2 |
| Runtime 基础设施（SQLite/日志/TaskState/记忆） | ✅ v0.2 |
| 子 Agent / MCP / Hooks / Skills | ✅ v0.2 |
| Model 容错 / 沙箱 / Trace | ✅ v0.2 |
| 存储按项目隔离 | ✅ v0.2 |
| VSCode 插件同步 | ✅ v0.2 |
| JetBrains 插件 ✅ 骨架就位骨架 | ✅ v0.2 |
| 异步消息队列（h2A 双缓冲） | ⏸️ 远期 |
| LSP 工具 / 代码索引 | ⏸️ 远期 |------|------|
| Agent Loop + 9 工具 + 多模型 | ✅ v0.2 |
| 上下文压缩 (summarize+truncate) | ✅ v0.2 |
| 权限流水线 + 执行确认 | ✅ v0.2 |
| 会话持久化 + Memory | ✅ v0.2 |
| Ink TUI 渲染 + 命令系统 | ✅ v0.2 |
| Runtime 数据结构（会话/消息/TaskState/日志/记忆） | ✅ v0.2 | §15 |
| 异步消息队列（h2A 双缓冲） | ⏸️ 远期 |
| 子 Agent / MCP / Hooks / Skills | ✅ v0.2 |
| Model 容错 / 沙箱 / Trace | ✅ v0.2 |
| VSCode 插件 | 🟡 v0.1 待同步 |
| JetBrains 插件 ✅ 骨架就位 | 📋 VSCode 稳定后跟进 |
| LSP 工具 / 代码索引 | ⏸️ 远期 |

---

## 0. 定位

做最好的 TUI Coding Agent。

- **本期**：TUI CLI — 终端代码 Agent，极致追求实战可用性
- **二期**：VSCode 插件同步更新，稳定后跟进 JetBrains 插件 ✅ 骨架就位
- **不做**：桌面 App、Web、云端、预计算索引、多 Agent 编排

竞品跟踪见 [competitors.md](competitors.md)。

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
│  │  │ read_file    │ │    │  │ TokenBudget        │  │         │
│  │  │ write_file   │ │    │  │ CompactionStrategy │  │         │
│  │  │ edit_file    │ │    │  │ MemorySystem       │  │         │
│  │  │ grep/glob    │ │    │  └────────────────────┘  │         │
│  │  │ bash         │ │    └──────────────────────────┘         │
│  │  │ todo_write   │ │                                         │
│  │  │ web_fetch    │ │                                         │
│  │  │ web_search   │ │                                         │
│  │  └──────────────┘ │                                         │
│  └────────┬──────────┘                                         │
│           │                                                     │
│  ┌────────▼────────────────────────────────────────┐          │
│  │   Permission Pipeline  │  Session Manager         │          │
│  │   (TypeScript)        │  (TypeScript + SQLite)   │          │
│  └──────────────────────────────────────────────────┘          │
└─────────────────────────┬──────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────────┐
│                    LLM Gateway (TypeScript)                      │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ Anthropic│  │  OpenAI  │  │ OpenAI-compat │   │
│  │ (Claude) │  │  (GPT)   │  │ (DeepSeek等)  │   │
│  └──────────┘  └──────────┘  └──────────────┘    │
│                                                   │
│  统一接口：Streaming │ Factory │ 未来: Retry/Fallback │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 为什么是这三层

| 层 | 职责 | 为什么独立 |
|----|------|-----------|
| **CLI / Plugin** | 交互界面（Ink TUI / VSCode Webview） | 纯展示和路由，不含 Agent 逻辑 |
| **Agent Runtime** | 循环、工具、上下文、权限 | 可独立运行、独立测试 |
| **LLM Gateway** | Provider 路由、流式调用 | 模型无关，可独立扩缩 |

**关键原则**：
1. UI 层不包含 Agent 逻辑（只做展示和路由）
2. Agent Runtime 不依赖任何 UI 框架
3. 三层之间通过 AgentEvent 流通信

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
## 3. Agent 系统设计

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
## 4. 代码理解策略

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

User Memory（用户级，~/.cangjie/）
  ┌──────────────────────────────┐
  │ 跨项目偏好、常用工具配置     │ → 每次会话自动加载
  │ 语言、风格、权限偏好         │
  └──────────────────────────────┘
```

### 5.5 会话协议

Agent 与 UI 层的通信通过 `AsyncGenerator<AgentEvent>` 流。

```
AgentEvent 类型:
  thinking    流式思考文字（逐 token）
  tool_call   工具调用请求
  tool_result 工具执行结果
  plan        任务计划更新
  response    最终回复
  compact     上下文压缩通知
  error       错误
  done        完成
```

**当前实现**：AgentEvent 流完整。会话持久化通过 JSON 文件，跨轮次复用 `agent.lastMessages`。

**待实现**：
- 会话检查点（Checkpoint）：长任务中断后从中间步数恢复
- 暂停/恢复信号：Ctrl+C 暂停等待新指令而非终止

### 5.6 异步消息队列（h2A 双缓冲）

Agent 执行过程中允许用户异步注入新消息。

```
Input Buffer           Agent Loop           Output Buffer
(用户随时写入)    ←   每轮前 drain()   →   (UI 按帧率消费)
```

**当前实现**：AbortSignal 支持硬中断（Ctrl+C 全停）。双缓冲未实现。

### 5.7 Model 管理

| 能力 | 状态 |
|------|------|
| 多 Provider 切换 (anthropic/openai/compat) | ✅ |
| 重试（API 错误自动重试，指数退避） | 📋 Phase 5 |
| 降级（主模型不可用自动切备用） | 📋 Phase 5 |
| 限流（请求队列 + token 桶） | 📋 Phase 5 |
| Usage 统计（会话级 token 累计） | 🟡 仅 StreamEvent 带 usage |

---

## 6. 子 Agent 与多 Agent 编排 ⚠️ 设计稿，Phase 4 实现

### 6.1 Claude Code 的子 Agent 教训

Claude Code 最初设计子 Agent 是为了并行工作，但发现子 Agent 更大的价值是：

1. **上下文隔离**：子 Agent 可以"炸掉自己的上下文"去搜索，只给父 Agent 结论
2. **角色专门化**：Explore Agent / Plan Agent / Verify Agent 各有专门的工具集
3. **独立权限**：子 Agent 只能读（默认），写操作需要父 Agent 授权

### 6.2 Cangjie 的子 Agent 类型

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
## 7. 插件与可扩展性

### 7.1 扩展体系（从低到高上下文成本）

| 机制 | 上下文成本 | 实现方式 | 对标 |
|------|-----------|---------|------|
| **Hooks** | 零 | 事件驱动，Tool Call 前后执行自定义脚本 | Claude Code Hooks |
| **Skills** | 低（按需加载 SKILL.md） | 专业能力文件，模型自己决定是否加载 | Claude Code Skills |
| **Commands** | 低 | `/review` `/test` 等快捷命令 | Custom slash commands |
| **MCP Servers** | 高 | 标准 MCP 协议接入外部工具 | Claude Code MCP |
| **Plugins** | 中 | Command + Skill + MCP 的组合包 | VS Code Extension |

### 7.2 LSP 作为一等工具（Cangjie 差异化）

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
## 8. 权限与安全

### 8.1 执行确认机制

不是所有 Action 都自动执行。按风险等级决定是否需要用户确认。

| 风险等级 | 工具 | 策略 | 确认信息 |
|---------|------|------|---------|
| `readonly` | read_file, grep, glob, todo_write | 自动通过 | — |
| `write` | write_file, edit_file | **必须确认** | 文件路径 + 内容预览 / diff |
| `execute` | bash | **必须确认** | 完整命令 + 超时 |
| `network` | web_fetch, web_search | **必须确认** | URL |

**决策选项**：`Y` 允许本次 / `A` 本次对话始终允许 / `N` 拒绝 / `D` 本次对话始终拒绝

**会话记忆**：A/D 记录到会话级规则，本次对话内不再问。`--yes` 跳过所有确认。

**确认流程**：
```
Agent Loop → Permission Pipeline → risk=needAsk? → TUI 弹窗展示详情 → 用户选择 → allow/deny
```

### 8.2 六层防御

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

### 8.3 权限是不可绕过的代码路径

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
## 9. 项目结构（Monorepo）

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
## 10. 开发路线图

### 已完成

**Phase 0：MVP（v0.1.0）** ✅
```
Agent Loop + 5 工具 + CLI REPL + VSCode 插件骨架 + 权限流水线 + 会话持久化
```

**Phase 1：补齐基础（v0.2.0）** ✅
```
+4 工具 + 多模型 Provider + 上下文压缩 + 分层配置
```

**Phase 2：TUI 交互升级（v0.2.0）** ✅
```
Ink 渲染 + 7 组件 + 命令系统 + 权限确认 Y/A/N/D
```

---

**Phase 3：Runtime 基础设施（v0.3.0）** ✅
```
会话管理：SQLite 持久化 + Checkpoint + SessionStats
消息管理：Message 扩展 (id/metadata/parentId) + 三级压缩
任务状态：TaskState 状态机 (planning→executing→verifying→done)
日志系统：pino 模块分级 (agent/tool/llm/perm)
记忆管理：四层结构 + Agent 自动生成 + 生命周期
```

**Phase 4：Agent 深度（v0.4.0）** ✅
```
异步消息队列：h2A 双缓冲
子 Agent：Explore/Plan/Verify/Execute + 独立上下文
MCP：stdio/SSE/HTTP + Tool 适配桥
Hooks：tool.execute.before/after + session.created + file.changed
Skills：SKILL.md 按需加载
```

**Phase 5：生产就绪（v0.5.0）** ✅
```
Model 容错：Retry + Fallback + Rate Limit + Usage 统计
沙箱增强：命令注入检测 + 审计日志 (SQLite)
全链路 Trace：Span 事件收集 + 会话结束 summary
JetBrains 插件 ✅ 骨架就位
```

### 远期暂缓
```
⏸️ LSP 工具、代码索引、远程执行
```

---

## 11. 关键设计决策记录

### 11.1 为什么 TypeScript + Bun

- TypeScript 全栈统一，CLI 和插件共享同一套代码
- Bun 启动 ~50ms，`bun build --compile` 单二进制分发
- Claude Code 用 TS 证明了 Agent Runtime 的可行性

### 11.2 为什么不 Fork VS Code 做独立 IDE

- Extension 即可覆盖 VSCode / Cursor / Windsurf
- Agent Runtime 独立进程，CLI 和插件都是它的前端
- 维护编辑器 Fork 是巨大的技术债务

### 11.3 为什么本地优先

- 代码是核心资产，不应上传
- 本地执行延迟最低
- API 直连，无中间服务

### 11.4 为什么不用预计算索引

- Agent 自己 grep 比 RAG 更准确
- 不维护额外的索引系统，降低复杂度

### 11.5 为什么先做 CLI

- CLI 是 Agent 最自然的交互形态
- CLI 用户是早期采用者，验证核心价值最快
- Agent Runtime 不依赖 UI 层，CLI 打磨好后插件自然受益

---

## 12. 核心指标

| 指标 | v0.2 当前 | v0.4 目标 |
|------|----------|----------|
| 工具数量 | 9 | 14+ |
| 模型支持 | 3 类 Provider | 3 类 Provider |
| 上下文压缩 | summarize + truncate | 可靠压缩 |
| CLI 启动时间 | < 500ms | < 100ms (Bun) |
| Agent 任务完成率 | 未测量 | > 70% |
| TUI 体验 | Ink 渲染 | 持续打磨 |

---

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
## 13. 发布与交付

### 13.1 阶段一：VSCode 插件发布

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

### 13.2 阶段二：独立桌面 App 发布（macOS / Windows / Linux）

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
## 14. 学习路径（跟着这个项目你能学到什么）

| 模块 | 学到的知识 |
|------|-----------|
| **Agent Loop** | 异步流程控制、Generator/AsyncGenerator、流式处理、状态机 |
| **Tool System** | 工具注册、权限流水线、Bun.spawn 进程管理 |
| **Context Engineering** | Token 预算、多级压缩策略、Prompt 构建 |
| **CLI / TUI** | Bun 运行时、Ink (React TUI)、终端渲染、键盘交互 |
| **VSCode Extension** | Extension Host 进程模型、Webview 通信、Editor API |
| **React in Webview** | 受限环境下的状态管理、虚拟 DOM diff、Tailwind 设计系统 |
| **Rust + TypeScript** | napi-rs FFI、Native Addon 构建、跨语言内存管理 |
| **Monorepo** | pnpm workspace、依赖管理、构建编排、版本策略 |
| **安全** | Fail-closed 设计、纵深防御、审计日志、沙箱隔离 |
| **测试** | Agent 行为测试、工具集成测试、E2E（Playwright） |
| **CI/CD** | GitHub Actions、自动化发布、版本管理 |

---

## 15. Runtime 数据结构设计 ⚠️ 设计稿，Phase 3 实现

### 15.1 会话管理

```
Session
├── id: string
├── workspace: string
├── status: 'active' | 'paused' | 'completed' | 'aborted'
├── createdAt / updatedAt
│
├── config: { provider, model, maxSteps, compactionStrategy }
├── messages: Message[]
├── checkpoints: Checkpoint[]
│   └── { step, messageIndex, summary, createdAt }
├── stats: { totalSteps, totalTokens, toolCalls, duration }
└── decisions: { step, tool, args, decision, timestamp }[]
```

生命周期：create → active → save checkpoint(每N步) → complete/abort → archive
持久化：当前 JSON 文件 → Phase 3 SQLite（增量写入）

### 15.2 消息管理

```
Message
├── id: string（新增）
├── role: 'system' | 'user' | 'assistant' | 'tool'
├── content: string
├── toolCalls? / toolCallId?
│
├── metadata: { step, timestamp, tokenCount, compacted }
└── parentId?: string（子 Agent 追溯）
```

消息分类：system prompt → project memory → conversation → compaction summary

三级压缩：70% summarize 前30% → 85% summarize 前50% → 92% emergency compact + checkpoint

### 15.3 子 Agent

```
SubAgent
├── id, type: 'explore' | 'plan' | 'verify' | 'execute'
├── parentSessionId, parentMessageId
├── status: 'running' | 'completed' | 'failed'
├── context: { messages, budget: { maxSteps, maxTokens } }
├── tools: string[]（默认只读）
└── result?: { summary, artifacts }
```

约束：独立上下文，默认只读，超时/失败不拖垮父 Agent

### 15.4 任务执行状态

```
TaskState
├── todos: { id, content, status, createdAt, completedAt }[]
├── currentStep: number
├── phase: 'planning' | 'executing' | 'verifying' | 'done'
└── executionTrace: {
      step, type: 'think'|'tool_call'|'tool_result'|'response',
      detail, toolName?, duration?, tokenUsage?, timestamp
    }[]
```

AgentEvent 流是实时通道，TaskState 是持久化快照

### 15.5 日志

```
Logger: pino 结构化输出
├── level: 'debug' | 'info' | 'warn' | 'error'
├── modules: agent | tool | llm | perm
└── output: stderr(开发) | ~/.cangjie/logs/(生产)
```

### 15.6 全链路 Trace

```
Trace
├── traceId, sessionId
├── startTime / endTime
└── spans: {
      spanId, parentSpanId?, type: 'llm_call'|'tool_exec'|'compaction'|'permission_check',
      startTime, endTime?, status, metadata
    }[]
```

### 15.7 记忆管理

```
记忆分层：
  User Memory    (~/.cangjie/memory/)     手动维护，长期有效
  Project Memory (.cangjie/memory/)       团队共享，版本控制
  Session Memory (内存)                   当前对话，会话后可提取关键结论
  Agent Memory   (~/.cangjie/memories/)   Agent 自动生成，跨会话积累

Memory 结构：
  { id, type, source, content: { title, body, tags },
    context: { files?, tools?, keywords? },
    meta: { createdAt, importance: 1-5, sourceSessionId? },
    status: 'active' | 'archived' | 'superseded' }

检索：Project/User Memory 全量注入 system prompt
      Agent Memory 按关键词 grep 检索，按需加载
```

---

*最后更新：2026-06-26*

*最后更新：2026-06-07*
*作者：Cangjie Team*

> **设计哲学**（来自 Claude Code 的核心教训）：
> "Less scaffolding, more model. Simple is better than complex. Give it tools and get out of the way."
