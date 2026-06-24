# Changelog

## [0.1.0] - 2026-06-25

### Added

- **CLI** (`@cangjie/cli`): 交互式 REPL 多轮对话、单次执行、流式输出、`--yes`/`--workspace`/`--model` 选项、`--list`/`--resume` 会话管理、会话持久化到 `~/.cangjie/sessions/`、项目 Memory 自动注入
- **Agent Core** (`@cangjie/core`): 自主循环、流式 LLM、5 个内置工具 (read_file, grep, write_file, edit_file, bash)、并发工具执行、上下文管理、权限管线 (onAsk 回调)、工具参数校验
- **VSCode 插件** (`cangjie`): Chat 面板、流式输出、Diff Review (逐文件 Accept/Reject)、权限确认弹窗、Cmd+K 行内编辑、编辑器上下文注入
- **工程基础设施**: Biome lint+format、TypeScript project references、vitest 测试、`.editorconfig`、`.nvmrc`、GitHub Actions CI

[0.1.0]: https://github.com/wzhongyou/cangjie/releases/tag/v0.1.0
