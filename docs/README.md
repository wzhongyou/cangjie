# Cangjie 技术文档

## 概述

Cangjie（仓颉）是一个统一的 AI Agent 平台，全 Go 实现（前端 TypeScript）。对 Codex、OpenCode、OpenClaw 做统一对标，目标成为市面上最完整的开源 Agent 产品。

## 文档导航

### 总体设计

| 文档 | 内容 |
|------|------|
| [竞品分析](competitive-analysis.md) | Codex / OpenCode / OpenClaw 能力对比与差异化定位 |
| [架构设计](architecture.md) | 总体架构、包结构、核心接口、数据流、设计决策 |
| [升级路线图](upgrade-roadmap.md) | 5 阶段升级路径、里程碑、版本规划 |

### 子系统设计

| 文档 | 内容 |
|------|------|
| [Agent 编排器](subsystems/orchestrator.md) | 统一编排接口，ReAct / Plan-Execute / Multi-Agent / Human-Loop |
| [工具系统](subsystems/tool-system.md) | Tool 接口、内置工具（文件/Shell/Git/搜索/浏览器）、MCP 集成、工具集运算 |
| [沙箱安全](subsystems/sandbox.md) | macOS Seatbelt / Linux Bubblewrap + seccomp、三级沙箱模式 |
| [项目上下文引擎](subsystems/context-engine.md) | LSP 集成、Tree-sitter 索引、语义嵌入、Git 上下文、文件监听 |
| [会话管理](subsystems/session.md) | SQLite 持久化、检查点、分支、上下文压缩、全文搜索 |
| [权限系统](subsystems/permission.md) | 分级权限（allow/deny/ask）、策略引擎、审计日志、HCL 配置 |
| [插件系统](subsystems/plugin.md) | 多形态插件（Go/WASM/子进程）、Wazero 沙箱、插件市场 |
| [多渠道网关](subsystems/gateway.md) | Telegram/Discord/Slack/WhatsApp/微信适配器、消息路由 |
| [AGUI 交互界面](subsystems/agui.md) | Web 聊天界面（React + SSE 流式），多端交互入口

## 快速链接

- **代码仓库**: [github.com/wzhongyou/cangjie](https://github.com/wzhongyou/cangjie)
- **核心依赖**: [Graphflow](https://github.com/wzhongyou/graphflow) (图引擎) | [llmgate](https://github.com/wzhongyou/llmgate) (LLM 网关)

## 技术栈

| 层次 | 技术 | 说明 |
|------|------|------|
| 后端语言 | Go 1.25+ | 全后端使用 Go，单二进制分发 |
| 前端语言 | TypeScript | Web Dashboard + VS Code 插件 |
| 图引擎 | Graphflow | 自研 Go 图执行引擎 |
| LLM 网关 | llmgate | 多模型统一接入 |
| MCP 协议 | mcp-go | Model Context Protocol 工具扩展 |
| TUI | Bubble Tea | Go 终端 UI 框架 |
| 数据库 | SQLite | 会话/任务/配置本地存储 |
| 向量存储 | Qdrant / Chroma / 内存 | 嵌入索引多种后端 |
| LSP | gopls / ts-ls / pyright / rust-analyzer | 多语言代码理解 |
| 沙箱 | Seatbelt / Bubblewrap / seccomp | OS 原生安全隔离 |
| 浏览器 | Playwright | 浏览器自动化 |
| 插件运行时 | Wazero / JSON-RPC | WASM + 子进程插件 |
| 前端框架 | Vite + React + Tailwind | AGUI 交互界面 |
| API 协议 | HTTP + SSE | REST + 流式响应 |

## 版本

当前版本: `v0.3.0` (AGUI + SSE 流式对话 + SQLite)

目标版本: `v1.0.0` (全渠道、全平台 Agent 产品)
