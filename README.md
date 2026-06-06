# Cangjie（仓颉）

> 仓颉造字，天雨粟，鬼夜哭。
> Cangjie invented writing — your agent writes code, everywhere.

[![Go Version](https://img.shields.io/badge/go-%3E%3D1.25-blue)](https://golang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Cangjie** 是一个统一的 AI Agent 平台。既是 CLI 工具、TUI 应用、IDE 插件、多渠道 Bot，也是可编程的 Agent API。

对标 **Codex**、**Claude Code**、**OpenCode**、**OpenClaw**，汲取各家长处，构建最完整的开源 Agent 产品。

> 全 Go + TypeScript 实现。单二进制，零运行时依赖。
> `brew install cangjie` 即可开始。

---

## 为什么叫 Cangjie？

中国神话中，仓颉创造了文字，让人类的语言得以被记录和传递。
Cangjie 继承同一使命：把你的想法变成代码，通过任何你喜欢的渠道。

---

## 入口

```
CLI / TUI               IDE 插件                Web Dashboard
    │                       │                       │
    ▼                       ▼                       ▼
  cj "..."          VS Code / JetBrains     http://localhost:9779
    │                       │                       │
    └───────────────────────┼───────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  Cangjie API  │
                    │  (HTTP+WS+gRPC)│
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        Telegram Bot   Discord Bot   Slack Bot  ...
```

---

## 安装

```bash
# macOS / Linux
brew install cangjie

# 或通过 go install
go install github.com/wzhongyou/cangjie/cmd/cj@latest
```

---

## 快速开始

```bash
# 设置 API key
export ANTHROPIC_API_KEY=sk-ant-...

# 交互式 TUI
cj

# 单次执行
cj "给这个项目加一个 HTTP 健康检查接口"

# 恢复之前的会话
cj --session resume=abc123

# 启动 API Server + Dashboard
cj server --port 9779
```

Mock 模式（无需 API key）：
```bash
go run ./examples/agent_demo
```

---

## 架构

```
入口层
├── CLI / TUI（Bubble Tea）  — 终端原生体验
├── VS Code / JetBrains       — IDE 深度集成
├── Web Dashboard             — 可视化管理
└── IM Gateway                — Telegram / Discord / Slack / 微信

核心引擎
├── Agent Orchestrator — ReAct / Plan-Execute / Multi-Agent / Human-Loop
├── Graphflow 图引擎    — 节点编排、并行执行、检查点、流式
├── Tool System         — 内置工具 + MCP 协议 + 插件扩展
├── Context Engine      — LSP 代码理解 + 语义索引 + Git 感知
├── Sandbox             — macOS Seatbelt / Linux Bubblewrap 原生沙箱
├── Memory              — 短期/长期/事件记忆
├── Permission          — 分级权限 + 审计日志
└── Session Manager     — 持久化、检查点、分支、压缩

基础设施
├── Scheduler            — Cron 定时任务 + 异步执行
├── Plugin System        — Go/WASM/子进程 多形态插件
└── Telemetry            — OTEL 可观测性
```

---

## 核心能力

- **全 Go 技术栈** — 单二进制分发，内存 < 100MB 空闲
- **多入口** — CLI、TUI、IDE 插件、Web Dashboard、IM Bot
- **多模型** — Anthropic / OpenAI / Gemini / DeepSeek / 本地模型
- **原生沙箱** — macOS Seatbelt / Linux Bubblewrap，OS 级隔离
- **代码理解** — LSP 协议 + Tree-sitter + 语义嵌入索引
- **MCP 协议** — 模型上下文协议，双向（客户端 + 服务端）
- **Agent 图编排** — 基于 Graphflow，支持 Plan-Execute、多 Agent 协作
- **流式响应** — 逐 Token 实时输出，思考过程可见
- **会话管理** — 持久化 + 检查点 + 分支 + 上下文压缩
- **权限系统** — allow/deny/ask 三级 + 策略引擎 + 审计日志
- **多渠道消息** — Telegram/Discord/Slack/WhatsApp/微信 Bot
- **定时调度** — Cron 定时任务 + 异步长时 Agent
- **插件生态** — WASM 插件 + 子进程插件，社区可扩展
- **审计透明** — 每步 diff 可审查，完整操作日志

---

## 包结构

```
cangjie/
├── cmd/cj/               # CLI/TUI 入口
├── cmd/cangjied/          # 守护进程 / API Server
├── agent/                 # Agent 抽象（LLM、节点、消息、状态）
├── orchestrator/          # Agent 编排（ReAct/Plan/Multi/HITL）
├── tool/                  # 工具系统（内置 + MCP + 插件）
├── sandbox/               # OS 沙箱（Seatbelt + Bubblewrap）
├── context/               # 项目上下文（LSP + 索引 + Git）
├── session/               # 会话管理（持久化 + 检查点）
├── permission/            # 权限系统（策略 + 审计）
├── memory/                # 记忆系统（短期 + 长期 + 向量存储）
├── server/                # API Server（HTTP + WS + gRPC）
├── tui/                   # 终端 UI（Bubble Tea）
├── plugin/                # 插件系统（WASM + 子进程）
├── gateway/               # 多渠道消息网关
├── scheduler/             # 调度系统（Cron + 异步）
├── conf/                  # 配置系统
├── web/                   # Web Dashboard（TypeScript）
├── ide/                   # IDE 插件（VS Code + JetBrains）
├── examples/              # 示例
└── docs/                  # 技术文档
```

---

## 文档

完整技术文档见 [docs/](docs/)：

- [竞品分析](docs/competitive-analysis.md)
- [架构设计](docs/architecture.md)
- [升级路线图](docs/upgrade-roadmap.md)
- [子系统设计](docs/subsystems/)

---

## 路线图

- [x] Phase 0: MVP 核心库 — ReAct / RAG / Supervisor / MCP
- [ ] Phase 1: 内核强化 — 工具系统 + 权限 + 会话 + CLI/TUI
- [ ] Phase 2: 安全与智能 — OS 沙箱 + LSP + Plan-Execute
- [ ] Phase 3: 平台化 — API Server + Web Dashboard + 插件系统
- [ ] Phase 4: 多渠道 — IM Bot + 调度系统
- [ ] Phase 5: IDE 集成 + 打磨 — VS Code 插件 + v1.0 发布

详见 [升级路线图](docs/upgrade-roadmap.md)。

---

## 与 Graphflow 的关系

```
Cangjie（仓颉）           → Agent 平台产品
  ├── import: github.com/wzhongyou/graphflow  → 图执行引擎
  └── import: github.com/wzhongyou/llmgate    → LLM 多模型网关
```

---

## 许可证

[MIT](LICENSE) © 2026 Wang Zhongyou
