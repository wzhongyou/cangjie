# Cangjie 升级路线图

## 概述

从当前状态（MVP Agent 核心库）到完整 Agent 产品平台的升级路径，分为 5 个阶段，预计总周期 12-16 周。

---

## 当前状态（Phase 0 基线）

### 已完成 ✅
| 模块 | 状态 |
|------|------|
| `agent/` 核心库 | ReAct / RAG / Supervisor Agent 模式 |
| `agent/llm.go` | LLM / Embedder / VectorStore 接口 |
| `agent/nodes.go` | LLMNode / ToolNode / VectorRetrieveNode / HITL(stub) |
| `agent/tools.go` | Tool 接口 / ToolRegistry / CalculatorTool |
| `agent/agents.go` | ReActAgent / RAGAgent / SupervisorAgent |
| `agent/memory.go` | ShortTermMemory / LongTermMemory |
| `agent/structured_output.go` | JSON Schema 约束输出 + 校验 |
| `agent/mcp_client.go` | MCP stdio 客户端（工具发现+调用） |
| `agent/llmgate/` | llmgate → agent.LLMModel 适配器 |
| `agent/agent_test.go` | 33 个单元测试，全覆盖 |
| `conf/` | llmgate.toml.example |
| `examples/` | 5 个示例程序 |
| `go.mod` | 依赖管理（graphflow + llmgate + mcp-go） |

### 待实现 ❌
- CLI/TUI 界面
- 文件系统工具（读写、编辑）
- Shell 执行工具
- Git 操作工具
- OS 级沙箱
- 会话持久化与恢复
- 项目上下文索引
- LSP 代码理解
- 权限系统
- API Server
- IDE 插件
- Web Dashboard
- 多渠道消息网关
- 插件系统
- 调度/定时任务

---

## Phase 1：内核强化（Week 1-2）

> **目标**：补齐核心 Agent 能力，让 CLI 工具可日常使用

### 1.1 工具系统扩充

```
tool/
├── tool.go                    # Tool 接口 + ToolRegistry（从 agent/ 迁移）
├── builtin/
│   ├── file.go                # 文件读/写/编辑
│   ├── shell.go               # Shell 命令执行（安全包装）
│   ├── git.go                 # Git status/diff/log/add/commit
│   ├── web_search.go          # Web 搜索（Bing/Google API）
│   ├── web_fetch.go           # 网页内容抓取
│   ├── editor.go              # 代码编辑器（基础，可插 LSP）
│   ├── calculator.go          # 计算器（迁移自 agent/tools.go）
│   └── mcp_manager.go         # MCP 工具管理
└── mcp/
    ├── client.go              # MCP 客户端（迁移自 agent/）
    ├── server.go              # Cangjie 作为 MCP Server
    └── manager.go             # 多 MCP server 管理
```

**具体任务**：
- [ ] `tool/builtin/file.go` — 支持读、写、替换、批量编辑
- [ ] `tool/builtin/shell.go` — 带超时、工作目录、环境变量隔离
- [ ] `tool/builtin/git.go` — status/diff/log/add/commit/branch/checkout
- [ ] `tool/builtin/web_search.go` — 通过搜索 API 获取信息
- [ ] `tool/builtin/web_fetch.go` — 抓取网页内容转 Markdown
- [ ] `tool/mcp/server.go` — 将 Cangjie 自身工具暴露为 MCP Server
- [ ] `agent/tools.go` 中 Tool 接口迁移到 `tool/tool.go`
- [ ] 向后兼容：`agent/tools.go` 保留 type alias

### 1.2 权限系统

```
permission/
├── permission.go              # Permission 类型定义
├── policy.go                  # 策略引擎
├── resolver.go                # 解析器（allow/deny/ask 三级）
└── audit.go                   # 审计日志
```

**具体任务**：
- [ ] 定义权限模型（file:read, file:write, shell:exec, network:out, git:*）
- [ ] 实现 allow/deny/ask 三级决策
- [ ] 支持 `--dangerously-skip-permissions` 模式
- [ ] 权限决策持久化（.cangjie_permissions）
- [ ] 审计日志（记录所有权限决策和工具调用）
- [ ] 集成到 ToolNode，每次工具调用前检查权限

### 1.3 会话管理

```
session/
├── session.go                 # Session 模型
├── store.go                   # SQLite 持久化
├── resume.go                  # 恢复机制
├── compression.go             # 上下文压缩
└── checkpoint.go              # 检查点
```

**具体任务**：
- [ ] Session 模型：ID、标题、消息列表、元数据、时间戳
- [ ] SQLite 存储：CRUD + checkpoint
- [ ] 会话列表、切换、恢复
- [ ] 上下文压缩：超过 token 限制时自动摘要早期消息
- [ ] 检查点：每 N 步自动保存，可回滚

### 1.4 CLI/TUI 界面

```
cmd/cj/main.go                 # CLI 入口
tui/
├── app.go                     # Bubble Tea 应用
├── models/
│   ├── chat.go                # 聊天面板
│   ├── diff.go                # Diff 预览
│   └── status.go              # 状态栏
└── components/
    ├── input.go               # 多行输入 + 历史
    ├── markdown.go            # Markdown 渲染
    └── confirm.go             # 权限确认对话框
```

**具体任务**：
- [ ] `cmd/cj/main.go` — CLI 入口，参数解析，交互/非交互模式
- [ ] TUI 主循环（Bubble Tea）
- [ ] 聊天面板：Markdown 渲染、流式输出、历史滚动
- [ ] Diff 预览：类似 `git diff` 的着色展示
- [ ] 权限确认对话框
- [ ] 快捷键：Ctrl+C 中断、Ctrl+D 退出、Ctrl+S 保存
- [ ] 单行模式：`cj "帮我加一个健康检查接口"`

**Phase 1 完成后效果**：
```bash
# 交互式 TUI
cj

# 单次执行
cj "给 main.go 加一个 HTTP 健康检查接口"

# 会话切换
cj --session resume=abc123
```

---

## Phase 2：安全与智能（Week 3-4）

> **目标**：OS 级沙箱 + 代码理解能力

### 2.1 OS 沙箱

```
sandbox/
├── sandbox.go                 # 沙箱接口
├── seatbelt_darwin.go         # macOS Seatbelt 实现
├── bubblewrap_linux.go        # Linux Bubblewrap 实现
├── fs_isolation.go            # 文件系统隔离策略
└── net_isolation.go           # 网络隔离策略
```

**具体任务**：
- [ ] 沙箱接口：`Sandbox.Run(cmd, policy) (result, error)`
- [ ] macOS Seatbelt：使用 sandbox-exec 限制文件/网络权限
- [ ] Linux Bubblewrap：使用 bwrap 创建隔离容器
- [ ] 文件系统隔离：只读根目录、可写工作区白名单
- [ ] 网络隔离：默认仅允许 API 出口，禁止入站
- [ ] `--sandbox=strict|loose|off` 三级沙箱模式
- [ ] 集成到 Shell 工具，所有 Shell 命令跑在沙箱中

### 2.2 项目上下文引擎

```
context/
├── project.go                 # 项目发现与分析
├── lsp/
│   ├── client.go              # LSP 协议客户端
│   ├── manager.go             # 多语言 LSP 进程管理
│   └── symbols.go             # 符号查询
├── indexer/
│   ├── indexer.go             # 索引器接口
│   ├── tree_sitter.go         # Tree-sitter 代码索引
│   └── embedding.go           # 语义嵌入索引
├── git_context.go             # Git 上下文
└── file_watcher.go            # 文件变更监听
```

**具体任务**：
- [ ] 项目发现：自动检测语言、框架、构建系统、依赖
- [ ] LSP 集成：Code Action、符号跳转、Hover、诊断
- [ ] Tree-sitter 代码索引：函数/类/接口/符号表
- [ ] 语义搜索：文本→Embedding→相似代码块检索
- [ ] Git 上下文：自动读取 diff、blame、log
- [ ] 文件监听：fsnotify 追踪变更

### 2.3 增强 Agent 编排

```
orchestrator/
├── orchestrator.go            # 统一编排接口
├── plan_execute.go            # Plan-Execute 模式
├── multi_agent.go             # 多 Agent 协作增强
├── human_loop.go              # 人机协同（HITL）
└── router.go                  # 智能路由
```

**具体任务**：
- [ ] Plan-Execute 模式：先分析生成计划，用户确认后批量执行
- [ ] 多 Agent 协作增强：Agent 间通信协议、结果聚合
- [ ] HITL：关键操作暂停等待人类确认
- [ ] 智能路由：根据任务自动选择 Agent 模式

---

## Phase 3：平台化（Week 5-7）

> **目标**：从单机工具变为可部署的平台

### 3.1 API Server

```
server/
├── server.go                  # HTTP + WebSocket 服务
├── rest/
│   ├── agent.go               # POST /api/agent/run
│   ├── session.go             # GET/PUT/DELETE /api/sessions
│   ├── tool.go                # GET /api/tools
│   └── config.go              # GET/PUT /api/config
├── ws/
│   └── stream.go              # WS /api/stream
├── grpc/
│   └── cangjie.proto          # gRPC 协议定义
└── middleware/
    ├── auth.go                # API Key / Bearer Token
    ├── cors.go                # CORS
    └── logging.go             # 结构化日志
```

**具体任务**：
- [ ] HTTP API Server（Go net/http / chi router）
- [ ] WebSocket 流式 API（Agent 实时输出）
- [ ] gRPC API（内部高性能通信）
- [ ] 认证：API Key + Bearer Token
- [ ] OpenAPI 文档自动生成
- [ ] 优雅关闭 + 健康检查

### 3.2 Web Dashboard（TypeScript）

```
web/
├── package.json
├── vite.config.ts
├── src/
│   ├── App.tsx                # 应用入口
│   ├── pages/
│   │   ├── Dashboard.tsx      # 仪表盘（会话、统计）
│   │   ├── Chat.tsx           # 对话界面
│   │   ├── Settings.tsx       # 配置管理
│   │   └── Logs.tsx           # 审计日志
│   ├── components/
│   │   ├── ChatPanel.tsx      # 聊天面板（流式）
│   │   ├── DiffViewer.tsx     # Diff 查看器
│   │   ├── FileTree.tsx       # 文件浏览器
│   │   ├── ToolCallCard.tsx   # 工具调用卡片
│   │   └── TokenUsage.tsx     # Token 用量图表
│   ├── hooks/
│   │   ├── useChat.ts         # 聊天 Hook
│   │   ├── useSession.ts      # 会话 Hook
│   │   └── useStream.ts       # WebSocket 流式 Hook
│   └── api/
│       └── client.ts          # API 客户端
```

**具体任务**：
- [ ] Vite + React + TypeScript 项目初始化
- [ ] 仪表盘：会话列表、工具状态、Token 用量
- [ ] 对话界面：Markdown 渲染、流式输出、Diff 预览
- [ ] 文件浏览器：工作区文件树 + 内容预览
- [ ] 设置页面：API 配置、模型选择、权限策略
- [ ] 构建产物嵌入 Go binary（embed.FS）

### 3.3 插件系统

```
plugin/
├── plugin.go                  # 插件接口
├── registry.go                # 注册中心
├── loader.go                  # 加载器
└── manifest.go                # 清单文件
```

**具体任务**：
- [ ] 插件接口：Tool + Hook + Channel
- [ ] 子进程插件：通过 stdin/stdout JSON-RPC 通信
- [ ] WASM 插件：Go 编译到 WASM，沙箱执行
- [ ] 插件发现：`~/.cangjie/plugins/` 目录扫描
- [ ] 插件管理 CLI：`cj plugin install/remove/list`

---

## Phase 4：多渠道 + 调度（Week 8-10）

> **目标**：从编程工具扩展为全场景个人 Agent

### 4.1 多渠道消息网关

```
gateway/
├── gateway.go                 # 网关接口
├── adapters/
│   ├── telegram.go            # Telegram Bot
│   ├── discord.go             # Discord Bot
│   ├── slack.go               # Slack Bot
│   ├── whatsapp.go            # WhatsApp Business API
│   ├── wechat.go              # 微信（企业微信）
│   └── webhook.go             # 通用 Webhook
└── router.go                  # 消息路由
```

**具体任务**：
- [ ] 统一消息网关接口
- [ ] Telegram Bot 适配器
- [ ] Discord Bot 适配器
- [ ] Slack Bot 适配器
- [ ] 消息路由：同一用户跨渠道会话关联
- [ ] 渠道配置：`cangjie.toml` 中配置各渠道 Token

### 4.2 调度系统

```
scheduler/
├── scheduler.go               # 调度器
├── job.go                     # 任务模型
├── cron.go                    # Cron 解析器
├── runner.go                  # 任务执行器
└── store.go                   # 任务持久化
```

**具体任务**：
- [ ] 定时任务：Cron 表达式，周期执行 Agent 指令
- [ ] 一次性任务：延迟执行
- [ ] 任务持久化：SQLite 存储，重启恢复
- [ ] 任务队列：并发控制、优先级
- [ ] 通知机制：任务完成时通过渠道推送

---

## Phase 5：IDE 集成 + 打磨（Week 11-14）

> **目标**：开发者体验完整闭环

### 5.1 VS Code 插件

```
ide/vscode/
├── package.json
├── src/
│   ├── extension.ts           # 插件入口
│   ├── chat/                  # 侧边栏聊天
│   ├── inline/                # 内联建议
│   ├── diff/                  # 变更预览
│   └── commands/              # 命令注册
└── tsconfig.json
```

**具体任务**：
- [ ] VS Code 侧边栏聊天面板
- [ ] 内联代码补全（调用 Cangjie API）
- [ ] Diff 预览 + 一键采纳
- [ ] 右键菜单：解释代码、生成测试、重构
- [ ] 快捷键集成

### 5.2 优化与打磨

- [ ] 启动性能优化（target < 500ms 冷启动）
- [ ] 上下文压缩策略优化（摘要 vs 截断 vs 滑动窗口）
- [ ] 流式输出体验优化（减抖动、断点续传）
- [ ] 错误恢复：LLM 调用失败自动重试
- [ ] 多语言 TUI 渲染（CJK 文本宽度处理）
- [ ] 主题系统（light/dark/custom）
- [ ] 文档完善：godoc、README、Quickstart
- [ ] Homebrew 公式

---

## 里程碑总览

```
Phase 0: MVP 核心库                       ✅ 当前
Phase 1: 内核强化                           Week 1-2
  ├── 工具系统（文件/Shell/Git/搜索）       Week 1
  ├── 权限系统                              Week 1
  ├── 会话管理                              Week 2
  └── CLI/TUI 界面                          Week 2

Phase 2: 安全与智能                         Week 3-4
  ├── OS 级别沙箱                           Week 3
  ├── 项目上下文引擎（LSP + 代码索引）        Week 3-4
  └── 增强 Agent 编排                       Week 4

Phase 3: 平台化                             Week 5-7
  ├── API Server                            Week 5
  ├── Web Dashboard                         Week 6-7
  └── 插件系统                              Week 7

Phase 4: 多渠道 + 调度                       Week 8-10
  ├── 多渠道消息网关                        Week 8-9
  └── 调度系统                              Week 9-10

Phase 5: IDE 集成 + 打磨                     Week 11-14
  ├── VS Code 插件                          Week 11-12
  ├── JetBrains 插件                        Week 13
  └── 优化 / 文档 / 发布                    Week 14
```

---

## 版本规划

| 版本 | 阶段 | 核心交付 |
|------|------|----------|
| v0.1.0 | Phase 0 | MVP：Agent 核心库 + 示例（当前） |
| v0.2.0 | Phase 1 | CLI/TUI 可用版：文件/Shell/Git 工具 + 会话管理 |
| v0.3.0 | Phase 2 | 沙箱安全 + LSP 代码理解 |
| v0.4.0 | Phase 3 | API Server + Web Dashboard |
| v0.5.0 | Phase 4 | 多渠道消息 + 调度系统 |
| v0.6.0 | Phase 5 | IDE 插件 + 体验打磨 |
| v1.0.0 | Final | 正式发布：全渠道、全平台 Agent 产品 |
