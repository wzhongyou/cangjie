# AGUI — 通用智能体交互界面

## 一、定位

AGUI 是 Cangjie 通用智能体的统一交互界面层。不只是网页，而是面向多端的交互入口平台。

**当前阶段**：Web SPA（React + TypeScript + Vite），类似 DeepSeek 官网体验
**未来规划**：桌面客户端（Electron/Tauri）、移动端（React Native/Flutter）、IDE 嵌入式面板

核心原则：
- **协议统一**：所有客户端通过同一套 HTTP + SSE API 与 Agent 通信
- **会话同步**：SQLite 持久化，多端共享同一会话历史
- **体验一致**：风格、交互模式、快捷键在不同端保持一致
- **可嵌入**：AGUI 可嵌入到 VS Code、JetBrains 等 IDE 面板中

## 二、架构

```
Browser (localhost:5173 / 9779)
    │
    ├─ GET  /               → AGUI SPA (Vite dev / embed)
    ├─ POST /api/agent/chat  → Agent 执行（非流式）
    ├─ GET  /api/agent/stream → Agent 执行（SSE 流式）
    ├─ GET  /api/sessions     → 会话列表
    ├─ GET  /api/sessions/:id → 会话详情
    └─ WS  /api/ws           → WebSocket（备选）
```

## 三、页面设计

```
┌──────────────────────────────────────────────────┐
│  Cangjie AGUI                          [会话列表] │
├───────────┬──────────────────────────────────────┤
│           │                                      │
│  会话     │  用户: 帮我写一个 HTTP 接口           │
│  列表     │                                      │
│           │  助手: 好的，我来帮你创建...           │
│  ─────── │  ```go                                │
│  今天     │  func handler(w, r) { ... }           │
│  ·健康检查│  ```                                  │
│  ·重构    │                                      │
│           │  用户: 再加个超时                     │
│  ─────── │                                      │
│  昨天     │  助手: ...（流式输出中）              │
│  ·日志    │                                      │
│           │                                      │
├───────────┴──────────────────────────────────────┤
│  [输入框                                 ]  [发送]│
└──────────────────────────────────────────────────┘
```

## 四、技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 框架 | React 18 + TypeScript | SPA |
| 构建 | Vite | 开发 + 生产构建 |
| 样式 | Tailwind CSS | 类似 DeepSeek 的简洁风格 |
| Markdown | react-markdown + remark-gfm | 渲染助手输出 |
| 代码高亮 | react-syntax-highlighter | 代码块着色 |
| 流式 | EventSource (SSE) | 服务端推送事件 |
| 状态 | React Context + useReducer | 会话状态管理 |

## 五、SQLite 数据模型

```sql
CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,       -- user / assistant / system / tool
    content    TEXT NOT NULL DEFAULT '',
    tool_calls TEXT DEFAULT NULL,   -- JSON, tool call details
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_session ON messages(session_id);
```

## 六、API 接口

### POST /api/agent/chat

```json
// Request
{"session_id": "xxx", "message": "帮我..."}

// Response (SSE stream)
data: {"type":"thought","content":"分析中..."}
data: {"type":"tool_call","name":"file_read","args":{"path":"main.go"}}
data: {"type":"tool_result","content":"package main..."}
data: {"type":"answer","content":"好的，我来帮你..."}
data: {"type":"done","tokens":1234}
```

### GET /api/sessions

```json
{"sessions": [{"id":"xxx","title":"健康检查","created_at":"..."}]}
```

### GET /api/sessions/:id

```json
{"session": {...}, "messages": [...]}
```
