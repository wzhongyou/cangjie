# 会话管理系统详细设计

## 一、设计目标

1. **持久化**：会话完整保存到 SQLite，跨进程恢复
2. **分支**：支持从任意检查点创建会话分支
3. **压缩**：上下文超过模型限制时自动压缩
4. **索引**：支持全文搜索历史会话

## 二、数据模型

```go
// Session 代表一次完整的 Agent 对话。
type Session struct {
    ID          string        `json:"id"`
    Title       string        `json:"title"`        // 自动从首条消息生成
    Messages    []Message     `json:"messages"`
    Checkpoints []Checkpoint  `json:"checkpoints"`
    Branches    []Branch      `json:"branches"`
    
    // 元数据
    WorkspaceRoot string       `json:"workspace_root"`
    Model         string       `json:"model"`
    TotalTokens   int          `json:"total_tokens"`
    Status        SessionStatus `json:"status"`
    
    CreatedAt     time.Time   `json:"created_at"`
    UpdatedAt     time.Time   `json:"updated_at"`
}

type SessionStatus string
const (
    StatusActive    SessionStatus = "active"
    StatusPaused    SessionStatus = "paused"     // 等待人类输入
    StatusCompleted SessionStatus = "completed"
    StatusAborted   SessionStatus = "aborted"
)

// Checkpoint 是会话在某个时间点的快照。
type Checkpoint struct {
    ID        string    `json:"id"`
    StepCount int       `json:"step_count"`  // 执行到第几步
    MessageID string    `json:"message_id"`  // 最后一条消息的 ID
    State     []byte    `json:"state"`       // JSON 序列化的完整状态
    CreatedAt time.Time `json:"created_at"`
}

// Branch 是从某个检查点分出的会话分支。
type Branch struct {
    ID           string `json:"id"`
    ParentID     string `json:"parent_id"`    // 源会话 ID
    CheckpointID string `json:"checkpoint_id"` // 从哪个检查点分出
    Name         string `json:"name"`
}
```

## 三、存储设计

### SQLite Schema

```sql
CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL DEFAULT '',
    workspace     TEXT NOT NULL DEFAULT '',
    model         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active',
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    msg_id          TEXT NOT NULL,
    role            TEXT NOT NULL,       -- user / assistant / system / tool
    content         TEXT NOT NULL DEFAULT '',
    reasoning       TEXT DEFAULT '',
    tool_calls      TEXT DEFAULT NULL,   -- JSON
    tool_call_id    TEXT DEFAULT '',
    tool_name       TEXT DEFAULT '',
    metadata        TEXT DEFAULT '{}',
    step_index      INTEGER NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session ON messages(session_id, step_index);

CREATE TABLE checkpoints (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    step_count    INTEGER NOT NULL,
    message_id    TEXT NOT NULL,
    state         BLOB NOT NULL,         -- gzip + JSON
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE branches (
    id            TEXT PRIMARY KEY,
    parent_id     TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id)    REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id)   REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
);

CREATE TABLE session_fts (
    session_id TEXT NOT NULL,
    content    TEXT NOT NULL
);
-- FTS5 全文搜索索引
CREATE VIRTUAL TABLE session_fts_idx USING fts5(
    session_id UNINDEXED,
    title,
    content,
    content='session_fts',
    content_rowid='rowid'
);
```

### Store 接口

```go
type SessionStore interface {
    // CRUD
    Save(session *Session) error
    Load(id string) (*Session, error)
    List(filter SessionFilter) ([]*SessionMeta, error)
    Delete(id string) error
    
    // Checkpoint
    SaveCheckpoint(sessionID string, cp Checkpoint) error
    ListCheckpoints(sessionID string) ([]Checkpoint, error)
    LoadCheckpoint(id string) (*Checkpoint, error)
    
    // Branch
    CreateBranch(parentID, checkpointID, name string) (*Session, error)
    ListBranches(parentID string) ([]Branch, error)
    
    // Search
    Search(query string, limit int) ([]*SessionMeta, error)
    
    // Maintenance
    Compact() error     // 压缩旧数据
    Export(id string, w io.Writer) error
    Import(r io.Reader) (*Session, error)
}
```

## 四、上下文压缩

### 压缩策略

当会话 token 数接近模型上限时，触发上下文压缩：

```go
type CompressionStrategy struct {
    MaxTokens      int  // 模型上限（如 200k）
    ReservedTokens int  // 为响应保留的 token（如 4k）
    KeepRecent     int  // 保留最近 N 条消息（如 10）
}

func (s *CompressionStrategy) ShouldCompress(messages []Message, currentTokens int) bool {
    return currentTokens > s.MaxTokens - s.ReservedTokens
}
```

### 压缩算法

```go
// CompressMessages 将早期消息压缩为摘要。
// 保留：
//   1. System 消息（完好保留）
//   2. 最近 KeepRecent 条消息（完好保留）
//   3. 有工具调用的消息结构
// 压缩：
//   早期用户+助手消息 → 摘要（调用 LLM 生成）
func CompressMessages(ctx context.Context, messages []Message, llm LLMModel, keepRecent int) ([]Message, error) {
    if len(messages) <= keepRecent {
        return messages, nil
    }
    
    // 1. 分离要压缩的和要保留的消息
    toCompress := messages[:len(messages)-keepRecent]
    recent := messages[len(messages)-keepRecent:]
    
    // 2. 提取 system 消息
    var systemMsgs, compressMsgs []Message
    for _, m := range toCompress {
        if m.Role == RoleSystem {
            systemMsgs = append(systemMsgs, m)
        } else {
            compressMsgs = append(compressMsgs, m)
        }
    }
    
    // 3. 生成摘要
    summary, err := generateSummary(ctx, llm, compressMsgs)
    if err != nil {
        // 降级：简单截断
        return append(systemMsgs, recent...), nil
    }
    
    // 4. 组装结果
    result := systemMsgs
    result = append(result, Message{
        Role:    RoleSystem,
        Content: fmt.Sprintf("[历史对话摘要]\n%s", summary),
    })
    result = append(result, recent...)
    
    return result, nil
}
```

## 五、会话恢复机制

```go
// Resume 恢复一个之前的会话。
func Resume(sessionID string, store SessionStore) (*Session, error) {
    session, err := store.Load(sessionID)
    if err != nil {
        return nil, fmt.Errorf("session not found: %s", sessionID)
    }
    
    session.Status = StatusActive
    session.UpdatedAt = time.Now()
    
    return session, nil
}

// ResumeFromCheckpoint 从检查点恢复。
func ResumeFromCheckpoint(sessionID, checkpointID string, store SessionStore) (*Session, error) {
    cp, err := store.LoadCheckpoint(checkpointID)
    if err != nil {
        return nil, err
    }
    
    var state MessageState
    json.Unmarshal(cp.State, &state)
    
    // 恢复到检查点状态
    session, _ := store.Load(sessionID)
    session.Messages = state.Messages
    session.StepCount = state.StepCount
    session.TotalTokens = state.TotalTokens
    
    return session, nil
}
```

## 六、CLI 命令

```bash
# 查看会话列表
cj session list

# 恢复会话
cj session resume <id>

# 从检查点恢复
cj session resume <id> --checkpoint <checkpoint-id>

# 分支会话
cj session branch <id> --checkpoint <checkpoint-id> --name "experiment"

# 删除会话
cj session delete <id>

# 导出/导入
cj session export <id> > session.json
cj session import session.json

# 搜索历史
cj session search "health check"
```
