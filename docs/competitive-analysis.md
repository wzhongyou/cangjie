# 竞品分析

## 概述

Cangjie 定位为统一 Agent 产品，对标四大主流 AI 编程/助手产品。本文档分析各竞品的核心能力、架构特点和差异化空间。

## 1. OpenAI Codex

### 产品形态
- **IDE 深度集成**（VS Code 为主，到 JetBrains）
- **云端 Agent**：在 OpenAI 服务器上运行，不需要本地资源
- **ChatGPT 集成**：可在 chatgpt.com 中管理 Codex 会话
- **Codex Web**：浏览器中的完整开发环境（基于 VS Code Server）

### 核心能力
| 能力 | 描述 |
|------|------|
| 远程执行 | Agent 在 OpenAI 云端运行，本地仅需 Codex CLI 做轻量桥接 |
| 代码编辑 | 深度 IDE 集成，原生 diff 预览、多文件编辑 |
| LSP 理解 | 语言服务器协议，语义级代码理解 |
| 文件系统 | 自动发现项目结构、依赖、构建系统 |
| Git 集成 | 自然语言 commit、PR 生成、代码审查 |
| 多模态 | 支持图片输入（截图、设计稿→代码） |
| 测试运行 | Agent 自行运行测试、linter、构建 |
| 自修复 | 根据测试/构建反馈自动修复代码 |
| 浏览器自动化 | Playwright 集成，可操作网页 |
| 知识检索 | 文档、代码库的 RAG 检索 |

### 架构特点
```
用户 IDE ⇄ Codex Cloud Agent
                ↓
         Sandbox VM (隔离执行)
                ↓
         Tools + LSP + Git + Browser
```

### 可借鉴点
- IDE 深度集成协议
- 云端 Agent + 本地桥接架构
- 自修复循环（test → fix → test）
- 浏览器自动化集成
- 多文件 diff 预览

---

## 2. OpenCode

### 产品形态
- **开源 TUI 编程助手**（Go 实现）
- 终端内交互，对标主流终端 Agent 体验
- 社区驱动，插件化架构

### 核心能力
| 能力 | 描述 |
|------|------|
| TUI 界面 | Bubble Tea 终端 UI，多面板布局 |
| 终端原生 | Go 实现，单二进制，零依赖 |
| 工具系统 | 文件编辑、Shell、Git 等内置工具 |
| MCP 支持 | MCP 协议工具扩展 |
| 多模型 | 支持 OpenAI / Anthropic / 本地模型 |
| 会话管理 | 会话保存、导出、恢复 |
| 自定义指令 | 项目级 .opencode.yaml 配置 |

### 架构特点
```
TUI (Bubble Tea) → Agent Core → LLM Providers
                       ↓
                  Tool Registry
                       ↓
               Filesystem / Shell / Git / MCP
```

### 可借鉴点
- TUI 实现方式（Bubble Tea）
- 项目级配置文件设计
- 轻量化、零依赖的发布策略
- 社区插件机制

---

## 3. OpenClaw

### 产品形态
- **个人 AI Agent 平台**（全渠道）
- 支持多渠道接入：WhatsApp、Telegram、Slack、Discord、Web Chat、SMS 等
- 可部署为个人/团队 AI 助手

### 核心能力
| 能力 | 描述 |
|------|------|
| 多渠道网关 | 统一的消息接收入口，适配多个 IM 平台 |
| Agent 引擎 | 可定制的 Agent 行为、工具、记忆 |
| 记忆系统 | 短期 + 长期记忆，用户偏好学习 |
| 工具网关 | 统一工具调用接口，可接入外部 API |
| 多 Agent | 子 Agent 路由、协作 |
| 沙箱执行 | 代码执行隔离 |
| 调度系统 | 定时任务、提醒、周期性执行 |
| 插件系统 | 社区可扩展的能力模块 |
| Web Dashboard | 管理面板，配置 Agent、查看日志 |

### 架构特点
```
WhatsApp / Telegram / Slack / ...
        ↓
  Message Gateway (Adapter per channel)
        ↓
  Agent Engine → Memory / Tools / Scheduler
        ↓
  Response Gateway → Channel Reply
```

### 可借鉴点
- 多渠道消息网关设计
- Web Dashboard 管理面板
- 调度/定时任务系统
- 插件化能力模块
- 用户偏好学习机制

---

## 差异化定位分析

| 维度 | Codex | OpenCode | OpenClaw | **Cangjie（目标）** |
|------|-------|----------|----------|---------------------|
| 语言栈 | TS/Python | Go | TypeScript | **Go + TS** |
| 部署方式 | 云端+本地桥接 | 本地 TUI | 自托管服务 | **本地 + 自托管 + 云端** |
| IDE 集成 | ★★★★★ | ★ | ★ | **★★★★**（VS Code + JetBrains） |
| 终端体验 | ★★ | ★★★★★ | ★★ | **★★★★★**（TUI） |
| 多渠道 | ★ | ★ | ★★★★★ | **★★★★**（TG/Discord/Slack/Wx） |
| 多 Agent | ★★★ | ★★ | ★★★ | **★★★★★**（图编排 + 层级） |
| 沙箱安全 | ★★★★★ | ★★ | ★★★ | **★★★★★**（OS 级） |
| 开源 | ✗ | ★★★★★ | ★★★★★ | **★★★★★** |
| 异步任务 | ★★★ | ★ | ★★★★ | **★★★★★**（调度系统） |
| Web UI | ★★★ | ★ | ★★★★ | **★★★★★**（Dashboard + Playground） |

### 核心差异点

1. **全 Go 技术栈** + **TypeScript 前端**：性能优于 TS 实现，内存占用低，单二进制分发
2. **统一产品**：不只是一个 CLI 工具，而是一个平台——CLI + TUI + IDE 插件 + Web Dashboard + 多渠道 Bot + 开放 API
3. **自托管能力**：可部署为团队/企业级 AI 编程助手服务，区别于纯客户端产品
4. **原生异步调度**：定时任务、周期巡检、长时间运行 Agent，类似 OpenClaw 但有更好的编程工具链
5. **图编排引擎**：底层 Graphflow 提供强大的多 Agent 协作能力，超越单 Agent ReAct 循环

---

## 总结

Cangjie 不是简单复制某个竞品，而是**汲取各家长处，构建一个更完整的统一 Agent 产品**：

- 取 Codex 的**IDE 深度集成 + 自修复循环**
- 取 OpenCode 的**轻量化 Go 实现 + 开源社区**
- 取 OpenClaw 的**多渠道接入 + 异步调度 + Web 管理**

目标：打造市面上**最完整的开源 Agent 平台**。
