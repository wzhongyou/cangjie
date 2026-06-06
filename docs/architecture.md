# Cangjie 架构设计文档

## 一、总体定位

**Cangjie = 统一 Agent 平台**

一个二进制，所有入口。既是 CLI 工具、TUI 应用、IDE 插件后端、多渠道 Bot、Web Dashboard，也是可编程的 Agent API。

---

## 二、架构全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         入口层 (Entry Layer)                         │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────────┐ ┌─────────────┐  │
│  │ CLI/TUI │ │ VS Code  │ │ JetBrains│ │ Web UI │ │ IM Gateway  │  │
│  │ (Go+TUI)│ │ (TS)     │ │ (Kotlin) │ │ (TS+Go)│ │ (Go Adapter)│  │
│  └────┬────┘ └────┬────┘ └────┬─────┘ └───┬────┘ └──────┬──────┘  │
│       └───────────┴───────────┴───────────┴──────────────┘         │
│                            │                                        │
│                     ┌──────▼──────┐                                 │
│                     │  API Server │  (HTTP + WebSocket + gRPC)      │
│                     └──────┬──────┘                                 │
└────────────────────────────┼────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│                    核心引擎层 (Core Engine)                           │
│  ┌─────────────────────────▼───────────────────────────────────┐   │
│  │                    Agent Orchestrator                        │   │
│  │  ┌───────────┐ ┌────────────┐ ┌──────────┐ ┌─────────────┐ │   │
│  │  │ ReAct Loop│ │ Plan-Exec  │ │Multi-Agent│ │ Human-Loop  │ │   │
│  │  └─────┬─────┘ └─────┬──────┘ └────┬─────┘ └──────┬──────┘ │   │
│  │        └──────────────┴────────────┴───────────────┘        │   │
│  └─────────────────────────┬───────────────────────────────────┘   │
│                            │                                        │
│  ┌─────────────────────────▼───────────────────────────────────┐   │
│  │              Graphflow 图执行引擎                             │   │
│  │  • 节点/边/条件/并行 • 流式执行 • 检查点 • 重试/回退          │   │
│  └─────────────────────────┬───────────────────────────────────┘   │
│                            │                                        │
│  ┌─────────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ │
│  │ LLM Hub │ │ Tool System│ │Sandbox  │ │ Memory   │ │ Context │ │
│  │(多模型) │ │(内置+MCP)  │ │(SeatBelt│ │(Short+   │ │(LSP+Git │ │
│  │         │ │            │ │/BubbleW)│ │ Long)    │ │+Index)  │ │
│  └─────────┘ └────────────┘ └─────────┘ └──────────┘ └─────────┘ │
└────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│                    基础设施层 (Infrastructure)                       │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Session  │ │ Scheduler│ │Auth/RBAC│ │Telemetry │ │ Plugin   │  │
│  │ Manager  │ │(Cron/Job)│ │         │ │(OTEL)    │ │ System   │  │
│  └──────────┘ └──────────┘ └─────────┘ └──────────┘ └──────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 三、包结构设计

```
cangjie/
├── cmd/                          # 入口程序
│   ├── cj/                       # 主 CLI/TUI 入口
│   │   └── main.go
│   └── cangjied/                 # 守护进程 / API Server 入口
│       └── main.go
│
├── agent/                        # Agent 抽象层（现有，重构增强）
│   ├── state.go                  # MessageState（已实现）
│   ├── message.go                # Message / ToolCall（已实现）
│   ├── llm.go                    # LLM / Embedder / VectorStore 接口（已实现）
│   ├── nodes.go                  # 图节点定义（已实现）
│   ├── tools.go                  # Tool 接口 + 内置工具（已实现，需扩展）
│   ├── agents.go                 # Agent 模式（已实现，需扩展）
│   ├── memory.go                 # 记忆系统（已实现，需增强）
│   ├── structured_output.go      # 结构化输出（已实现）
│   ├── mcp_client.go             # MCP 客户端（已实现）
│   └── llmgate/                  # LLM 网关适配（已实现）
│
├── orchestrator/                 # [NEW] Agent 编排器
│   ├── orchestrator.go           # 统一编排接口
│   ├── plan_execute.go           # Plan-Execute 模式
│   ├── multi_agent.go            # 多 Agent 协作
│   ├── human_loop.go             # 人机协同（HITL）
│   └── router.go                 # 智能路由
│
├── tool/                         # [NEW] 工具系统（独立包，从 agent/ 迁移）
│   ├── tool.go                   # Tool 接口 + Registry（迁移）
│   ├── builtin/                  # 内置工具
│   │   ├── file.go               # 文件读写
│   │   ├── shell.go              # Shell 执行
│   │   ├── git.go                # Git 操作
│   │   ├── web_search.go         # 网页搜索
│   │   ├── web_fetch.go          # 网页抓取
│   │   ├── browser.go            # 浏览器自动化（Playwright）
│   │   ├── editor.go             # 代码编辑器（LSP 驱动）
│   │   ├── test_runner.go        # 测试运行
│   │   └── calculator.go         # 计算器（已有，迁移）
│   ├── mcp/                      # MCP 协议工具
│   │   ├── client.go             # MCP 客户端（迁移）
│   │   ├── server.go             # MCP 服务端（供外部调用 Cangjie）
│   │   └── manager.go            # MCP 服务生命周期管理
│   └── toolset.go                # 工具集管理
│
├── sandbox/                      # [NEW] 沙箱安全
│   ├── sandbox.go                # 沙箱接口
│   ├── seatbelt_darwin.go        # macOS Seatbelt
│   ├── bubblewrap_linux.go       # Linux Bubblewrap
│   ├── seccomp.go                # Linux seccomp 规则
│   ├── fs_isolation.go           # 文件系统隔离
│   └── net_isolation.go          # 网络隔离
│
├── context/                      # [NEW] 项目上下文引擎
│   ├── project.go                # 项目发现与分析
│   ├── lsp/                      # LSP 客户端
│   │   ├── client.go             # LSP 协议客户端
│   │   ├── manager.go            # 多语言 LSP 管理
│   │   └── symbols.go            # 符号索引
│   ├── indexer/                  # 代码索引
│   │   ├── indexer.go            # 索引器接口
│   │   ├── tree_sitter.go        # Tree-sitter AST 索引
│   │   └── embedding.go          # 语义嵌入索引
│   ├── git_context.go            # Git 上下文（diff、blame、log）
│   └── file_watcher.go           # 文件变更监听
│
├── session/                      # [NEW] 会话管理
│   ├── session.go                # 会话模型
│   ├── store.go                  # 持久化存储
│   ├── resume.go                 # 会话恢复
│   ├── branch.go                 # 会话分支
│   ├── compression.go            # 上下文压缩
│   └── checkpoint.go             # 检查点
│
├── permission/                   # [NEW] 权限系统
│   ├── permission.go             # 权限模型
│   ├── policy.go                 # 策略引擎
│   ├── resolver.go               # 权限解析（allow/deny/ask）
│   └── audit.go                  # 审计日志
│
├── memory/                       # [NEW] 增强记忆系统
│   ├── short_term.go             # 短期记忆（迁移 agent/memory.go）
│   ├── long_term.go              # 长期记忆（迁移 + 增强）
│   ├── episodic.go               # 事件记忆
│   ├── preference.go             # 用户偏好学习
│   └── vector_store/             # 向量存储后端
│       ├── memory.go             # 内存向量存储
│       ├── qdrant.go             # Qdrant
│       └── chroma.go             # Chroma
│
├── server/                       # [NEW] API Server
│   ├── server.go                 # HTTP + WebSocket + gRPC 服务
│   ├── rest/                     # REST API
│   │   ├── agent.go              # Agent 执行 API
│   │   ├── session.go            # 会话管理 API
│   │   ├── tool.go               # 工具管理 API
│   │   └── config.go             # 配置管理 API
│   ├── ws/                       # WebSocket（实时流）
│   │   └── stream.go
│   ├── grpc/                     # gRPC API
│   │   └── cangjie.proto
│   └── middleware/               # 中间件
│       ├── auth.go               # 认证
│       ├── cors.go               # CORS
│       └── logging.go            # 请求日志
│
├── tui/                          # [NEW] 终端 UI
│   ├── app.go                    # Bubble Tea 应用
│   ├── models/                   # UI 模型
│   │   ├── chat.go               # 聊天面板
│   │   ├── diff.go               # Diff 预览
│   │   ├── file_browser.go       # 文件浏览
│   │   └── status.go             # 状态栏
│   ├── components/               # 可复用组件
│   │   ├── input.go              # 输入框（多行 + 历史）
│   │   ├── markdown.go           # Markdown 渲染
│   │   ├── spinner.go            # 加载动画
│   │   └── confirm.go            # 确认对话框
│   └── styles/                   # 主题样式
│       └── theme.go
│
├── plugin/                       # [NEW] 插件系统
│   ├── plugin.go                 # 插件接口
│   ├── registry.go               # 插件注册中心
│   ├── loader.go                 # 插件加载（Go plugin / Wasm / 子进程）
│   └── manifest.go               # 插件清单
│
├── gateway/                      # [NEW] 多渠道消息网关
│   ├── gateway.go                # 网关接口
│   ├── adapters/                 # 渠道适配器
│   │   ├── telegram.go           # Telegram Bot
│   │   ├── discord.go            # Discord Bot
│   │   ├── slack.go              # Slack Bot
│   │   ├── whatsapp.go           # WhatsApp
│   │   ├── wechat.go             # 微信
│   │   └── webhook.go            # 通用 Webhook
│   └── router.go                 # 消息路由
│
├── scheduler/                    # [NEW] 调度系统
│   ├── scheduler.go              # 调度器
│   ├── job.go                    # 任务模型
│   ├── cron.go                   # Cron 解析
│   ├── runner.go                 # 任务执行器
│   └── store.go                  # 任务持久化
│
├── config/                       # 配置系统（增强）
│   ├── config.go                 # 配置模型
│   ├── loader.go                 # 配置加载（TOML/YAML/JSON）
│   ├── profile.go                # 项目配置（.cangjie.yaml）
│   └── llmgate.toml.example      # （已有）
│
├── docs/                         # 技术文档
│   ├── README.md                 # 文档索引
│   ├── competitive-analysis.md   # 竞品分析
│   ├── architecture.md           # 架构文档（本文件）
│   ├── upgrade-roadmap.md        # 升级路线图
│   └── subsystems/               # 子系统详细设计
│       ├── orchestrator.md
│       ├── tool-system.md
│       ├── sandbox.md
│       ├── context-engine.md
│       ├── session.md
│       ├── permission.md
│       ├── plugin.md
│       ├── gateway.md
│       └── scheduler.md
│
├── web/                          # [NEW] Web 前端（TypeScript）
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx               # React 应用入口
│   │   ├── pages/                # 页面
│   │   │   ├── Dashboard.tsx     # 仪表盘
│   │   │   ├── Chat.tsx          # 对话界面
│   │   │   ├── Settings.tsx      # 设置
│   │   │   └── Logs.tsx          # 日志查看
│   │   ├── components/           # 组件
│   │   │   ├── ChatPanel.tsx     # 聊天面板
│   │   │   ├── DiffViewer.tsx    # Diff 查看器
│   │   │   ├── FileTree.tsx      # 文件树
│   │   │   ├── ToolCallCard.tsx  # 工具调用卡片
│   │   │   └── TokenUsage.tsx    # Token 用量图
│   │   ├── hooks/                # Hooks
│   │   ├── api/                  # API 客户端
│   │   └── types/                # 类型定义
│   └── vite.config.ts
│
├── ide/                          # [NEW] IDE 插件
│   ├── vscode/                   # VS Code 插件
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── extension.ts      # 插件入口
│   │   │   ├── chat/             # 聊天面板
│   │   │   ├── inline/           # 内联补全
│   │   │   └── diff/             # Diff 预览
│   │   └── tsconfig.json
│   └── jetbrains/                # JetBrains 插件（Kotlin）
│
├── examples/                     # 示例（已有，扩充）
│   ├── agent_demo/               # （已有）
│   ├── streaming/                # （已有）
│   ├── supervisor/               # （已有）
│   ├── structured_output/        # （已有）
│   ├── mcp/                      # （已有）
│   ├── sandbox/                  # [NEW] 沙箱示例
│   ├── multi_agent/              # [NEW] 多 Agent 协作
│   └── server/                   # [NEW] API Server 示例
│
└── README.md                     # （已有，待更新）
```

---

## 四、核心接口设计

### 4.1 Agent 编排器接口

```go
// Orchestrator 是统一的 Agent 编排接口，所有模式都实现它。
type Orchestrator interface {
    // Run 同步执行 Agent 任务。
    Run(ctx context.Context, session *Session, input Message) (*RunResult, error)

    // RunStream 流式执行，实时返回中间状态。
    RunStream(ctx context.Context, session *Session, input Message) (<-chan *StreamEvent, error)

    // Validate 校验任务参数和执行计划。
    Validate(ctx context.Context, session *Session) (*ValidationResult, error)
}

// OrchestrationMode 定义编排模式。
type OrchestrationMode string
const (
    ModeReAct       OrchestrationMode = "react"       // 思考-行动循环
    ModePlanExecute OrchestrationMode = "plan-execute" // 计划-执行
    ModeMultiAgent  OrchestrationMode = "multi-agent"  // 多 Agent 协作
    ModeHumanLoop   OrchestrationMode = "human-loop"   // 人机协同
)
```

### 4.2 工具系统接口

```go
// Tool 是单个工具的能力抽象。
type Tool interface {
    Name() string
    Description() string
    Parameters() map[string]any            // JSON Schema
    Execute(ctx context.Context, args map[string]any) (string, error)
}

// SafeTool 扩展了 Tool，支持沙箱约束和安全声明。
type SafeTool interface {
    Tool
    SandboxPolicy() SandboxPolicy           // 沙箱策略
    RequiredPermissions() []Permission       // 所需权限
    AffectedPaths() []string                // 影响的文件路径
    IsReadOnly() bool                       // 是否只读
}

// ToolManager 管理工具生命周期。
type ToolManager interface {
    Register(tool Tool) error
    Unregister(name string) error
    List(filter ToolFilter) []Tool
    Get(name string) (Tool, bool)
    EnableMCP(mcpConfig MCPConfig) error
    DisableMCP(name string) error
}
```

### 4.3 会话管理接口

```go
// Session 代表一次 Agent 对话会话。
type Session struct {
    ID          string
    Title       string
    Messages    []Message
    Checkpoints []Checkpoint
    Branches    []Branch
    Metadata    SessionMetadata
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

// SessionStore 是会话持久化接口。
type SessionStore interface {
    Save(session *Session) error
    Load(id string) (*Session, error)
    List(filter SessionFilter) ([]*Session, error)
    Delete(id string) error
    Checkpoint(sessionID string, cp Checkpoint) error
    Restore(sessionID string, checkpointID string) (*Session, error)
    Branch(sessionID string, from checkpointID string, name string) (*Session, error)
}
```

### 4.4 权限系统接口

```go
// Permission 表示一个操作权限。
type Permission string

const (
    PermFileRead    Permission = "file:read"
    PermFileWrite   Permission = "file:write"
    PermShellExec   Permission = "shell:exec"
    PermNetworkOut  Permission = "network:out"
    PermGitRead     Permission = "git:read"
    PermGitWrite    Permission = "git:write"
)

// PolicyEngine 决定是否允许一个操作。
type PolicyEngine interface {
    // Check 检查权限。返回 allow/deny/ask。
    Check(ctx context.Context, session *Session, op Operation) Decision
    // Learn 从用户决策中学习，更新策略。
    Learn(ctx context.Context, op Operation, decision Decision) error
}

// Decision 是权限决策结果。
type Decision string
const (
    DecisionAllow Decision = "allow"
    DecisionDeny  Decision = "deny"
    DecisionAsk   Decision = "ask"
)
```

### 4.5 多渠道网关接口

```go
// Channel 是消息渠道的抽象。
type Channel interface {
    ID() string
    Receive(ctx context.Context) (<-chan *IncomingMessage, error)
    Send(ctx context.Context, msg *OutgoingMessage) error
    Platform() Platform  // telegram, discord, slack, wechat, ...
}

// Gateway 统一管理多渠道。
type Gateway interface {
    Register(channel Channel) error
    Unregister(channelID string) error
    Route(ctx context.Context, msg *IncomingMessage) (*OutgoingMessage, error)
    Broadcast(ctx context.Context, msg *OutgoingMessage) error
}
```

---

## 五、数据流

### 5.1 CLI/TUI 请求流

```
用户输入 (CLI/TUI)
    │
    ▼
[Permission Check] ──(ask)──→ 提示用户确认
    │(allow)
    ▼
[Session.Resume/Load] ──→ [Context Engine] ──→ 构建项目上下文
    │
    ▼
[Agent Orchestrator]
    ├── Plan Phase: LLM 分析意图，生成计划
    ├── Execute Phase: Graphflow 驱动工具调用
    │     ├── [Tool] → [Permission Check] → [Sandbox] → 执行
    │     └── [Tool Result] → Agent 决策下一个工具或完成
    └── Reflect Phase: 验证结果，自我修正
    │
    ▼
[Response] ──→ TUI 渲染（Markdown + Diff 预览 + Token 用量）
```

### 5.2 多渠道消息流

```
Telegram/Discord/Slack/...
    │
    ▼
[Gateway Adapter] ──→ 消息标准化
    │
    ▼
[Session Manager] ──→ 关联用户会话
    │
    ▼
[Agent Orchestrator]（同上流程）
    │
    ▼
[Response] ──→ [Gateway Adapter] ──→ 渠道回复
```

### 5.3 Web Dashboard 流

```
Browser (WebSocket)
    │
    ▼
[API Server] ──→ REST + WebSocket
    │
    ├── GET /api/sessions ──→ [Session Store]
    ├── POST /api/chat ──→ [Agent Orchestrator.Run]
    ├── WS /api/stream ──→ [Agent Orchestrator.RunStream]
    ├── GET /api/logs ──→ [Audit Log]
    └── PUT /api/config ──→ [Config Manager]
```

---

## 六、关键设计决策

### 6.1 为什么全 Go + TypeScript？

- **Go** 是后端最佳选择：高并发、低内存、单二进制、原生沙箱支持
- **TypeScript** 是前端事实标准：React/Vue 生态、IDE 插件（VS Code 原生 TS API）
- **边界清晰**：Go ↔ TS 通过 HTTP + WebSocket + gRPC 通信，无耦合

### 6.2 为什么自建 API Server 而不是全靠 CLI？

- 支持 Web Dashboard
- 支持 IDE 插件远程后端
- 支持团队共享 Agent 实例
- 支持定时任务 / 后台长时间运行 Agent

### 6.3 沙箱为什么是必须的？

- AI 生成的代码不能直接信任执行
- Claude Code 已证明 OS 级沙箱是可行的
- 遵循最小权限原则：文件只读、Shell 可控、网络可审计

### 6.4 为什么需要多渠道？

- 编程 Agent 不只是 IDE/Terminal 场景
- 需要异步交互：在 IM 中给 Agent 下任务，稍后查看结果
- OpenClaw 已验证多渠道 Agent 的价值

---

## 七、性能目标

| 指标 | 目标值 |
|------|--------|
| 冷启动时间 | < 500ms |
| 首个 Token 响应 | < 1s（端到端） |
| 内存占用（空闲） | < 100MB |
| 内存占用（活跃会话） | < 500MB / 会话 |
| WebSocket 并发连接 | 10,000+ / 进程 |
| 单二进制大小 | < 80MB（不含 AI 模型） |

---

## 八、安全目标

| 维度 | 措施 |
|------|------|
| 代码执行隔离 | OS 级沙箱（Seatbelt/Bubblewrap） |
| 文件访问控制 | 默认只读，写入需确认；路径白名单 |
| 网络访问控制 | 默认只允许 API 域名，其他需确认 |
| 密钥管理 | 不记录 API Key；支持 Keychain / Secret Manager |
| 审计日志 | 所有工具调用、权限决策、Shell 命令完整记录 |
