# 工具系统详细设计

## 一、设计原则

1. **统一接口**：所有工具实现统一的 `Tool` 接口，包括内置工具、MCP 工具、插件工具
2. **安全优先**：每个工具声明所需权限和沙箱策略
3. **可组合**：`ToolRegistry` 支持工具集的并、交、差运算
4. **可扩展**：三种扩展方式 — Go 内置、MCP 协议、插件子进程

## 二、接口定义

```go
// Tool 是所有工具的基础接口。
type Tool interface {
    Name() string
    Description() string
    Parameters() map[string]any // JSON Schema
    Execute(ctx context.Context, args map[string]any) (string, error)
}

// SafeTool 扩展 Tool，声明安全和权限信息。
type SafeTool interface {
    Tool

    // IsReadOnly 工具是否只读，如只读则权限更宽松。
    IsReadOnly() bool

    // RequiredPermissions 所需权限列表。
    RequiredPermissions() []Permission

    // AffectedPaths 声明工具会影响的文件路径（用于路径白名单）。
    // 返回 nil 表示未知（需用户确认）。
    AffectedPaths(args map[string]any) []string
}
```

## 三、内置工具列表

### FileTool — 文件操作

```go
// 能力：
// - file_read(path) → 读取文件内容
// - file_write(path, content) → 写入文件（覆盖）
// - file_edit(path, old, new) → 精确字符串替换编辑
// - file_list(dir) → 列出目录内容
// - file_search(pattern, dir) → glob 搜索文件

// 权限：file:read / file:write
// 沙箱：限制在项目目录内
```

### ShellTool — Shell 执行

```go
// 能力：
// - shell_exec(command, cwd, env) → 执行 Shell 命令

// 安全：
// - 超时：默认 120s，最大 600s
// - 工作目录：默认项目根，不可超出
// - 环境变量：白名单传入
// - 沙箱：所有命令在 OS 沙箱中执行
// - 命令黑名单：禁止 rm -rf /、curl | sh 等危险模式

// 权限：shell:exec
```

### GitTool — Git 操作

```go
// 能力：
// - git_status() → 查看工作区状态
// - git_diff(staged, file) → 查看 diff
// - git_log(n, file) → 查看提交历史
// - git_add(files) → 暂存文件
// - git_commit(message) → 提交（需确认）
// - git_branch(name) → 创建分支
// - git_checkout(branch) → 切换分支

// 权限：git:read / git:write
```

### WebSearchTool — 网页搜索

```go
// 能力：
// - web_search(query) → 搜索互联网

// 后端支持：Bing API / Google Custom Search / Brave Search
// 返回：[{title, url, snippet}]
```

### WebFetchTool — 网页抓取

```go
// 能力：
// - web_fetch(url) → 抓取网页内容转 Markdown

// 安全：
// - 默认只允许 HTTP/HTTPS
// - 限制响应大小（默认 1MB）
// - 15 分钟缓存
// - 禁止内网地址（192.168, 10., 172.16-31, 127., localhost）
```

### BrowserTool — 浏览器自动化

```go
// 能力：
// - browser_navigate(url) → 打开网页
// - browser_screenshot() → 截图
// - browser_click(selector) → 点击元素
// - browser_type(selector, text) → 输入文本
// - browser_get_text(selector) → 获取文本

// 后端：Playwright（通过子进程）
// 权限：browser:control
```

### EditorTool — 代码编辑器

```go
// 能力：
// - editor_open(file, line) → 打开文件并定位
// - editor_replace(file, old, new) → 替换（同 file_edit）
// - editor_insert(file, line, content) → 在指定行插入
// - editor_delete(file, start_line, end_line) → 删除行范围
// - editor_format(file) → 格式化代码
// - editor_diagnostics(file) → 获取诊断信息

// 集成 LSP 获得：
// - 自动补全候选
// - 语法错误检测
// - 符号重命名（未来）
```

### TestRunnerTool — 测试运行

```go
// 能力：
// - test_run(command) → 运行测试命令，返回结果
// - auto 模式：自动检测项目测试框架并运行

// 自修复循环：
//   Agent 修改代码 → 运行测试 → 失败 → Agent 分析失败 → 修复 → 再测试
```

## 四、MCP 集成

### MCP Client Manager

```go
type MCPManager struct {
    servers map[string]*MCPServerProcess
    tools   *ToolRegistry
}

// MCPManager 管理多个 MCP 服务器进程的生命周期。
func NewMCPManager() *MCPManager

// AddServer 添加并启动一个 MCP 服务器。
func (m *MCPManager) AddServer(name string, config MCPConfig) error

// RemoveServer 停止并移除一个 MCP 服务器。
func (m *MCPManager) RemoveServer(name string) error

// Tools 返回所有 MCP 服务器提供的工具。
func (m *MCPManager) Tools() []Tool
```

### Cangjie as MCP Server

将 Cangjie 自身的能力暴露为 MCP 协议，供其他 MCP 客户端调用：

```go
// CangjieMCPServer 将 Cangjie 暴露为 MCP Server。
// 其他 MCP 客户端可以通过 MCP 协议调用 Cangjie 的工具。
type CangjieMCPServer struct {
    tools   *ToolRegistry
    server  *mcp.Server
}

func (s *CangjieMCPServer) Serve(ctx context.Context) error
```

## 五、工具集运算

```go
// ToolSet 支持集合运算，方便配置不同场景的工具集。
type ToolSet struct {
    tools map[string]Tool
}

func (ts *ToolSet) Union(other *ToolSet) *ToolSet       // 并集
func (ts *ToolSet) Intersection(other *ToolSet) *ToolSet // 交集
func (ts *ToolSet) Difference(other *ToolSet) *ToolSet   // 差集
func (ts *ToolSet) Filter(fn func(Tool) bool) *ToolSet   // 过滤
```

使用场景：
```go
// 代码审查场景：不需要 Shell
codeReviewTools := allTools.Difference(shellTools)

// 安全场景：只要只读工具
readOnlyTools := allTools.Filter(func(t Tool) bool {
    if st, ok := t.(SafeTool); ok {
        return st.IsReadOnly()
    }
    return false
})
```
