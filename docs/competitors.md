# 竞品持续追踪

> 更新于 2026-06-26（Phase 1 完成，TUI CLI 建设期），每两周 Review 一次。

---

## 当前阶段关注重点

由于策略转向 **TUI CLI 优先**，当前重点关注 CLI 形态的竞品：

| 竞品 | CLI 成熟度 | 重点关注方向 |
|------|-----------|-------------|
| **Claude Code** | ★★★★★ | Agent Loop 设计、工具系统、上下文压缩 |
| **Codex CLI** | ★★★★★ | TUI 体验、沙箱安全、/goal 自主执行 |
| **OpenCode** | ★★★★★ | 多模型支持、LSP 集成、插件生态 |
| **Aider** | ★★★★☆ | Agent 极简主义、Benchmark 驱动 |

---

## 监控清单

### Tier 1：直接对标（每周关注）

| 产品 | 团队 | 形态 | 技术栈 | 关注重点 |
|------|------|------|--------|---------|
| **Cursor** | Anysphere (美国) | VS Code Fork + Electron | TS + Rust | Agent 模式演进、Tab 模型、索引架构、定价策略 |
| **Claude Code** | Anthropic (美国) | CLI / Terminal Agent | TypeScript | Agent Loop 设计、工具系统、上下文压缩、Permission 模型 |
| **Trae** | ByteDance (中国) | VS Code Fork + Electron | TS + Electron | SOLO 双智能体、中文优化、MCP 集成 |
| **Comate** | Baidu (中国) | 自研 IDE | 未公开 | 多智能体协同（Zulu）、F2C 设计稿转代码、中文理解 |

### Tier 2：重要参考（每月关注）

| 产品 | 团队 | 形态 | 关注重点 |
|------|------|------|---------|
| **Codex (OpenAI)** | OpenAI | IDE + CLI + Web | 云端 Agent 架构、自修复循环 |
| **Windsurf** | Codeium (美国) | VS Code Fork | Cascade Agent 流式、多文件编辑 |
| **GitHub Copilot** | Microsoft | IDE 插件 | Agent Mode (Coding Agent)、Copilot Chat 演进 |
| **Aider** | 开源社区 | CLI (Python) | Agent 架构极简主义、Benchmark 驱动 |
| **Manus** | Manus (中国) | Web + CLI | 通用任务 Agent、长任务执行 |
| **GenSpark** | GenSpark (中国) | Web | 通用 Agent 平台、多领域覆盖 |

### Tier 3：开源参考（按需关注）

| 产品 | 形态 | 学习价值 |
|------|------|---------|
| **Continue** | VSCode + JetBrains 插件 | 开源 RAG + Chat 架构 |
| **Cline** | VSCode 插件 | Agent 自主执行、MCP 集成 |
| **OpenCode** | TUI (Go) | 零依赖、单二进制设计 |
| **Roo Code** | VSCode 插件 | 多模型切换、自定义 System Prompt |
| **Qwen Code** | CLI (阿里) | 开源代码 Agent 实现 |

---

## 追踪维度

每个季度对 Tier 1 产品做一次深度分析，覆盖：

1. **产品形态变化** — 插件→独立 App？新增什么入口？
2. **Agent 能力升级** — 多 Agent？Plan-Execute？自主性到什么程度？
3. **代码理解改善** — 索引方案？RAG 策略？上下文窗口利用？
4. **交互体验迭代** — Inline Edit？Diff Review？Agent 可视化？
5. **技术架构演进** — 技术栈变化？性能优化手段？
6. **商业模式变化** — 定价、开源策略、企业功能

---

## 监控方式

| 渠道 | 频率 | 关注什么 |
|------|------|---------|
| 官方 Changelog / Blog | 发布时 | 功能更新、架构决策 |
| GitHub Releases | 发布时 | OSS 项目的版本变化 |
| Hacker News / Reddit | 每周 | 社区讨论、用户反馈 |
| 技术博客（Towards Data Science / 知乎 / 掘金） | 每月 | 深度分析文章 |
| Twitter/X（核心开发者） | 日常 | 碎片信息、Roadmap 暗示 |
| 竞品产品内体验 | 每月 | 亲自用，感知变化 |
