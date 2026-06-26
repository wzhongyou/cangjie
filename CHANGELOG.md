# Changelog

## [0.2.0] - 2026-06-26

### CLI

- Ink (React TUI) 渲染层，7 个组件：ChatView / DiffView / StatusBar / InputBox / PlanPanel / PermissionPrompt / MessageBubble
- 6 个斜杠命令：/help /save /exit /memory /list /clear
- 双模式自动切换：TTY → TUI，管道 → 纯文本
- 语法高亮 Diff + Markdown 代码块渲染

### Core

- 工具扩充至 10 个：+glob +todo_write +web_fetch +web_search +task
- 多模型 Provider：Anthropic + OpenAI + OpenAI-compat
- 容错层：重试 + 指数退避 + Fallback + Rate Limit
- SQLite 会话持久化（5 表）
- 四层记忆系统 + MCP 客户端 + Hooks + Skills + Trace
- 沙箱命令注入检测 + 权限审计日志
- 17 个冒烟测试覆盖

## [0.1.0] - 2026-06-25

- CLI：交互式 REPL、流式输出、会话管理、Memory 自动注入
- Core：Agent Loop、5 工具（read_file, grep, write_file, edit_file, bash）、权限管线、上下文管理
- 工程：Biome lint+format、TypeScript project references、vitest

[0.2.0]: https://github.com/wzhongyou/cangjie/releases/tag/v0.2.0
[0.1.0]: https://github.com/wzhongyou/cangjie/releases/tag/v0.1.0
