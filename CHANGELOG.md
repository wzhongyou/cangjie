# Changelog

## [0.2.0] - 2026-06-26

### Added

**CLI — TUI 交互升级**
- Ink (React TUI) 渲染层：ChatView、DiffView、StatusBar、PlanPanel、PermissionPrompt、InputBox 共 7 组件
- 斜杠命令系统：/help /save /exit /memory /list /clear 6 内置命令，CommandRegistry 可扩展
- 语法高亮 Diff（+绿/-红/@@青）+ Markdown 代码块渲染
- 执行确认 Y/A/N/D 四选项，按工具类型展示命令/文件/URL 预览，会话级记忆
- 双模式自动切换：TTY → TUI，管道 → 纯文本

**Agent Core — 工具扩充 & 多模型**
- 5 个新工具：glob（文件查找）、todo_write（任务规划）、web_fetch（网页获取）、web_search（网络搜索）、task（子 Agent 调度）
- 共 10 个内置工具
- 多模型 Provider：Anthropic + OpenAI + OpenAI-compat（覆盖 50+ 厂商）
- Model 容错：自动重试 3 次 + 指数退避 + Fallback 切换 + Rate Limit

**Runtime 基础设施**
- pino 结构化日志：agent / tool / llm / perm 四级模块分级输出
- SQLite 会话持久化：5 表（sessions/messages/checkpoints/decisions/stats）
- 存储按项目隔离：会话 JSON + SQLite 均存于 `.cangjie/` 目录
- TaskState 状态机：planning → executing → verifying → done + StepRecord 追踪
- 四层记忆管理：User / Project / Session / Agent，Agent 自动生成 + grep 检索
- 全链路 Trace：Span 收集（llm_call/tool_exec/permission_check）

**Agent 深度**
- 子 Agent（Task 工具）：独立上下文隔离 + spawnSubAgent 调度
- MCP 客户端：stdio 传输 + 自动连接 + Tool 适配桥
- Hooks 系统：4 事件点（tool.before/after + session.created + file.changed）
- Skills 系统：SKILL.md 按需加载 + discoverSkills 扫描

**安全**
- 沙箱命令注入检测：backticks/\$(...)/eval/curl-pipe 等危险模式拦截
- 权限决策审计日志写入 SQLite
- 路径遍历防护

**VSCode 插件同步**
- 多模型 Provider 支持 + Resilient client
- Skills + Memory + Hooks 自动加载
- MCP 工具注册
- 新增 VSCode 配置项：llm.baseUrl / llm.maxTokens / context.maxHistoryTokens / mcp

**JetBrains 插件骨架**
- Kotlin + Gradle 项目，ToolWindow + Cmd+K Inline Edit + Explain Code
- AgentBridgeService 通过 spawn `cj` 子进程工作

**工程**
- 目录结构调整：`plugin/` → `ide/vscode/`，新增 `ide/jetbrains/`
- 存储按项目隔离，会话不跨项目混用
- 17 个冒烟测试覆盖

## [0.1.0] - 2026-06-25

### Added

- **CLI** (`@cangjie/cli`): 交互式 REPL 多轮对话、单次执行、流式输出、`--yes`/`--workspace`/`--model` 选项、`--list`/`--resume` 会话管理、会话持久化到 `~/.cangjie/sessions/`、项目 Memory 自动注入
- **Agent Core** (`@cangjie/core`): 自主循环、流式 LLM、5 个内置工具 (read_file, grep, write_file, edit_file, bash)、并发工具执行、上下文管理、权限管线
- **VSCode 插件** (`cangjie`): Chat 面板、流式输出、Diff Review、权限确认、Cmd+K 行内编辑、编辑器上下文注入
- **工程基础设施**: Biome lint+format、TypeScript project references、vitest 测试

[0.2.0]: https://github.com/wzhongyou/cangjie/releases/tag/v0.2.0
[0.1.0]: https://github.com/wzhongyou/cangjie/releases/tag/v0.1.0
