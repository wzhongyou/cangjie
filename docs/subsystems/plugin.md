# 插件系统详细设计

## 一、设计目标

1. **多形态插件**：支持 Go 原生插件、WASM 插件、子进程插件
2. **安全隔离**：插件运行在受限环境中
3. **热加载**：安装/卸载插件无需重启 Cangjie
4. **社区生态**：标准化插件市场协议

## 二、插件分类

| 插件类型 | 接口 | 用途 | 示例 |
|----------|------|------|------|
| Tool Plugin | `Tool` | 扩展工具能力 | 数据库查询、JIRA、Slack API |
| Hook Plugin | `Hook` | 生命周期钩子 | 自定义 pre-commit 检查、日志发送 |
| Channel Plugin | `Channel` | 渠道适配器 | 飞书、钉钉、企业微信 |
| Provider Plugin | `LLMModel` | 模型提供商 | 自定义私有模型接入 |

## 三、插件接口

```go
// Plugin 是所有插件的基接口。
type Plugin interface {
    // Info 返回插件元信息。
    Info() PluginInfo
    
    // Init 初始化插件，传入宿主服务。
    Init(ctx context.Context, host HostServices) error
    
    // Shutdown 清理资源。
    Shutdown(ctx context.Context) error
}

type PluginInfo struct {
    Name        string      `json:"name"`
    Version     string      `json:"version"`
    Description string      `json:"description"`
    Author      string      `json:"author"`
    Type        PluginType  `json:"type"`  // tool, hook, channel, provider
    License     string      `json:"license"`
    
    // 依赖
    Requires    []string    `json:"requires"`    // 对其他插件的依赖
    MinVersion  string      `json:"min_version"` // 宿主最低版本
}

type PluginType string
const (
    TypeTool     PluginType = "tool"
    TypeHook     PluginType = "hook"
    TypeChannel  PluginType = "channel"
    TypeProvider PluginType = "provider"
)

// HostServices 是宿主暴露给插件的能力。
type HostServices interface {
    // 日志
    Logger() Logger
    
    // 配置访问
    GetConfig(key string) (string, error)
    SetConfig(key, value string) error
    
    // 事件发布
    EmitEvent(event PluginEvent) error
    
    // 工具注册（用于插件注册自己的工具）
    RegisterTool(tool Tool) error
}
```

### 各类型插件接口

```go
// ToolPlugin 提供工具的插件。
type ToolPlugin interface {
    Plugin
    // Tools 返回插件提供的工具列表。
    Tools() []Tool
}

// HookPlugin 提供生命周期钩子的插件。
type HookPlugin interface {
    Plugin
    // Hooks 返回钩子列表。
    Hooks() map[HookPoint]HookFunc
}

type HookPoint string
const (
    HookAgentStart   HookPoint = "agent:start"
    HookAgentEnd     HookPoint = "agent:end"
    HookToolBefore   HookPoint = "tool:before"
    HookToolAfter    HookPoint = "tool:after"
    HookPermission   HookPoint = "permission:check"
    HookSessionStart HookPoint = "session:start"
    HookSessionEnd   HookPoint = "session:end"
)

type HookFunc func(ctx context.Context, event HookEvent) error

// ChannelPlugin 提供消息渠道的插件。
type ChannelPlugin interface {
    Plugin
    Channels() []Channel
}
```

## 四、三种运行形态

### 4.1 Go 原生插件（仅 dev 模式）

```go
//go:build plugin

// 使用 Go 标准 plugin 包（cgo required）
type GoPluginLoader struct{}

func (l *GoPluginLoader) Load(path string) (Plugin, error) {
    p, err := plugin.Open(path)
    if err != nil {
        return nil, err
    }
    
    sym, err := p.Lookup("Plugin")
    if err != nil {
        return nil, err
    }
    
    return sym.(Plugin), nil
}
```

### 4.2 WASM 插件（推荐）

```go
// WASMPluginLoader 加载 WASM 插件，在 Wazero 运行时中执行。
// 优势：跨平台、无 cgo 依赖、天然沙箱

type WASMPluginLoader struct {
    runtime wazero.Runtime
}

func (l *WASMPluginLoader) Load(ctx context.Context, wasmBytes []byte) (Plugin, error) {
    // 编译 WASM 模块
    module, _ := l.runtime.CompileModule(ctx, wasmBytes)
    
    // 实例化，只暴露允许的宿主函数
    config := wazero.NewModuleConfig().
        WithName("plugin").
        WithStdin(os.Stdin).
        WithStdout(os.Stdout)
    
    instance, _ := l.runtime.InstantiateModule(ctx, module, config)
    
    // 调用 WASM 导出的函数
    return &wasmPlugin{instance: instance}, nil
}
```

### 4.3 子进程插件（兼容性最高）

```go
// SubprocessPluginLoader 通过 stdin/stdout JSON-RPC 与子进程插件通信。
// 优势：任何语言（Python、Node.js、Rust）都可编写插件

type SubprocessPluginLoader struct{}

func (l *SubprocessPluginLoader) Load(cmd string, args ...string) (Plugin, error) {
    proc := exec.Command(cmd, args...)
    
    stdin, _ := proc.StdinPipe()
    stdout, _ := proc.StdoutPipe()
    
    proc.Start()
    
    return &subprocessPlugin{
        cmd:    proc,
        stdin:  stdin,
        stdout: stdout,
        rpc:    jsonrpc.New(stdout, stdin),
    }, nil
}

// 子进程通信协议（JSON-RPC 2.0）：
//
// → {"jsonrpc":"2.0","method":"init","params":{"config":{}}, "id":1}
// ← {"jsonrpc":"2.0","result":{"info":{"name":"my-plugin","version":"1.0"}},"id":1}
//
// → {"jsonrpc":"2.0","method":"tool.execute","params":{"name":"search","args":{"q":"test"}},"id":2}
// ← {"jsonrpc":"2.0","result":{"content":"results..."},"id":2}
```

## 五、插件清单

```yaml
# plugin.yaml — 插件清单文件格式
name: github-search
version: 1.0.0
description: Search GitHub repositories and issues
author: community
license: MIT
type: tool
runtime: wasm   # wasm | subprocess | native

# 依赖
requires: []
min_version: "0.4.0"

# 入口
entry:
  wasm: plugin.wasm
  # 或
  # subprocess:
  #   command: python3
  #   args: ["-m", "github_search"]
  #   requirements: ["requests>=2.28"]

# 沙箱配置
sandbox:
  allow_network:
    - api.github.com
  allow_files:
    read:
      - "~/.cache/cangjie/**"
    write:
      - "~/.cache/cangjie/**"

# 权限声明
permissions:
  - network:outbound
    
# 配置项
config:
  github_token:
    description: GitHub personal access token
    required: true
    secret: true
  organization:
    description: Default organization to search
    default: ""
```

## 六、插件管理 CLI

```bash
# 安装插件
cj plugin install github.com/cangjie-plugins/github-search

# 从本地安装
cj plugin install ./my-plugin

# 查看已安装
cj plugin list

# 详细信息
cj plugin info github-search

# 启用/禁用
cj plugin enable github-search
cj plugin disable github-search

# 卸载
cj plugin remove github-search

# 更新
cj plugin update github-search

# 搜索
cj plugin search "jira"
```

## 七、安全模型

```
用户请求安装插件
    │
    ▼
[检查插件签名] ──(未签名)──→ 警告用户
    │(已签名)
    ▼
[解析权限声明]
    │
    ▼
[用户确认权限] ──(拒绝)──→ 取消安装
    │(确认)
    ▼
[安装到 ~/.cangjie/plugins/]
    │
    ▼
[加载时套上沙箱策略]
    - WASM: Wazero 沙箱限制
    - 子进程: 继承宿主沙箱策略
    - 网络: 仅允许声明的域名
    - 文件: 仅允许 ~/.cangjie/ 下的目录
```
