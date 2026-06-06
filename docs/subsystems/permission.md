# 权限系统详细设计

## 一、设计原则

1. **最小权限**：默认拒绝一切，只允许声明过的操作
2. **渐进信任**：用户逐步建立信任，而非一次性全开
3. **透明可审计**：所有权限决策有日志、可回溯

## 二、权限模型

### 权限类型

```go
type Permission string

const (
    // 文件权限
    PermFileRead  Permission = "file:read"
    PermFileWrite Permission = "file:write"
    
    // Shell 权限
    PermShellExec Permission = "shell:exec"
    
    // 网络权限
    PermNetworkOutbound  Permission = "network:outbound"
    PermNetworkInbound   Permission = "network:inbound"   // reserve, usually denied
    
    // Git 权限
    PermGitRead  Permission = "git:read"
    PermGitWrite Permission = "git:write"
    
    // 浏览器权限
    PermBrowserControl Permission = "browser:control"
    
    // 特殊权限
    PermPluginLoad   Permission = "plugin:load"
    PermConfigModify Permission = "config:modify"
)
```

### 决策模型

```go
type Decision string
const (
    DecisionAllow Decision = "allow"
    DecisionDeny  Decision = "deny"
    DecisionAsk   Decision = "ask"
)

// Decision 可以有条件和时效性：
//   allow always       — 始终允许
//   allow this session  — 本次会话允许
//   allow once          — 仅此一次
//   deny always        — 始终拒绝
//   deny this session  — 本次会话拒绝

type DecisionScope string
const (
    ScopeOnce    DecisionScope = "once"
    ScopeSession DecisionScope = "session"
    ScopeAlways  DecisionScope = "always"
)

type PermissionDecision struct {
    Permission  Permission
    Decision    Decision
    Scope       DecisionScope
    Reason      string    // 决策理由
    Timestamp   time.Time
}
```

## 三、策略引擎

```go
type PolicyEngine struct {
    rules  []PolicyRule
    store  DecisionStore // 持久化用户决策
}

// PolicyRule 定义一条权限规则。
type PolicyRule struct {
    Permission  Permission
    PathPattern string   // glob 模式，匹配文件路径（文件权限适用）
    Command     string   // 命令名（Shell 权限适用）
    Domain      string   // 域名（网络权限适用）
    Decision    Decision
    Reason      string
    Priority    int      // 优先级，数字越小越优先
}

// Check 检查操作是否允许。
func (pe *PolicyEngine) Check(ctx context.Context, session *Session, op Operation) Decision {
    // 1. 检查是否有 Always 级别的历史决策
    if hist, ok := pe.store.Lookup(op.Permission, op.Target); ok {
        if hist.Scope == ScopeAlways {
            return hist.Decision
        }
    }
    
    // 2. 匹配策略规则
    for _, rule := range pe.rules {
        if pe.match(rule, op) {
            return rule.Decision
        }
    }
    
    // 3. 未匹配任何规则 → Ask
    return DecisionAsk
}
```

### 默认策略

```go
var DefaultPolicy = []PolicyRule{
    // 项目目录内：允许读，写入需确认
    {Permission: PermFileRead,  PathPattern: "{workspace}/**",     Decision: DecisionAllow, Priority: 100},
    {Permission: PermFileWrite, PathPattern: "{workspace}/**",     Decision: DecisionAsk,   Priority: 100},
    
    // 系统目录：只读
    {Permission: PermFileRead,  PathPattern: "/usr/**",            Decision: DecisionAllow, Priority: 200},
    {Permission: PermFileRead,  PathPattern: "/System/**",         Decision: DecisionAllow, Priority: 200},
    {Permission: PermFileWrite, PathPattern: "/usr/**",            Decision: DecisionDeny,  Priority: 200},
    
    // 隐藏文件：需确认
    {Permission: PermFileWrite, PathPattern: "{workspace}/.**",    Decision: DecisionAsk,   Priority: 150},
    
    // Shell：默认拒绝危险命令
    {Permission: PermShellExec, Command: "rm",                     Decision: DecisionDeny,  Priority: 10},
    {Permission: PermShellExec, Command: "sudo",                   Decision: DecisionDeny,  Priority: 10},
    {Permission: PermShellExec, Command: "chmod",                  Decision: DecisionAsk,   Priority: 10},
    
    // Git 读取：允许
    {Permission: PermGitRead,  Decision: DecisionAllow, Priority: 300},
    {Permission: PermGitWrite, Decision: DecisionAsk,   Priority: 300},
    
    // 网络：允许 API 域名
    {Permission: PermNetworkOutbound, Domain: "api.openai.com",     Decision: DecisionAllow, Priority: 400},
    {Permission: PermNetworkOutbound, Domain: "api.anthropic.com",  Decision: DecisionAllow, Priority: 400},
    {Permission: PermNetworkOutbound, Domain: "api.github.com",     Decision: DecisionAllow, Priority: 400},
}
```

## 四、交互流程

### TUI 权限确认

```
┌──────────────────────────────────────────────┐
│ 🔐 权限请求                                   │
│                                              │
│ 工具: Shell 执行                              │
│ 命令: curl -s https://api.example.com/data    │
│ 权限: network:outbound → api.example.com      │
│                                              │
│ [A] 允许一次  [S] 本次会话允许                  │
│ [D] 拒绝      [K] 始终允许此域名               │
│ [N] 始终拒绝此域名                             │
└──────────────────────────────────────────────┘
```

### 非交互模式

```bash
# 宽松模式：自动允许
cj --permission loose

# 严格模式：非白名单一律拒绝
cj --permission strict

# 预授权
cj --allow "file:write:**/*.go" --allow "network:outbound:api.github.com"

# 从文件加载策略
cj --policy policy.toml
```

## 五、审计日志

```go
// AuditEntry 记录每个操作和权限决策。
type AuditEntry struct {
    ID          string
    SessionID   string
    Timestamp   time.Time
    
    Tool        string            // 工具名称
    Operation   string            // 操作描述
    Permission  Permission        // 所需权限
    Target      string            // 操作目标（路径/域名/命令）
    Args        map[string]any    // 工具参数（脱敏后）
    
    Decision    Decision
    Scope       DecisionScope
    UserInput   string            // 用户输入（如果是 ask 模式）
    
    Result      string            // 操作结果（成功/失败）
    Duration    time.Duration     // 操作耗时
    Error       string            // 如果有错误
}

// AuditLogger 写入审计日志。
type AuditLogger interface {
    Log(entry AuditEntry) error
    Query(filter AuditFilter) ([]AuditEntry, error)
}
```

## 六、hcl/permission 配置示例

```hcl
# cangjie_policy.hcl
permission "file:read" {
  allow = ["**"]
}

permission "file:write" {
  allow = ["src/**", "*.go", "*.md"]
  deny  = [".env", "*.key", "*.pem", "**/secrets/**"]
}

permission "shell:exec" {
  deny_commands = ["rm -rf", "curl | sh", "sudo", "chmod 777"]
  max_runtime   = "300s"
}

permission "network:outbound" {
  allowed_domains = [
    "api.openai.com",
    "api.anthropic.com",
    "api.github.com",
    "*.pkg.dev",
    "*.npmjs.org",
    "crates.io",
  ]
}

permission "git:write" {
  require_confirmation = true
  allowed_branches     = ["feature/**", "fix/**", "dev"]
  deny_branches        = ["main", "master", "release/**"]
}
```
