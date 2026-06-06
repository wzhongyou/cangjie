# 项目上下文引擎详细设计

## 一、设计目标

让 Agent 理解代码库的**结构**和**语义**，而不仅仅看到文本。核心能力：

1. **项目发现**：自动识别语言、框架、构建系统、项目结构
2. **LSP 理解**：通过语言服务器获得 IDE 级别的代码理解
3. **语义索引**：代码嵌入 + 向量搜索，找到相关代码
4. **Git 感知**：自动获取 diff/历史/blame 信息

## 二、架构

```
Context Engine
    ├── Project Analyzer     → 项目结构、语言、框架
    ├── LSP Manager          → 多语言 LSP 进程池
    │   ├── gopls (Go)
    │   ├── typescript-language-server (TS/JS)
    │   ├── pyright (Python)
    │   ├── rust-analyzer (Rust)
    │   └── ...
    ├── Code Indexer          → 代码索引
    │   ├── Tree-sitter Parser → AST 级结构化索引
    │   └── Embedding Engine   → 语义嵌入索引
    └── Git Context           → Git 感知
```

## 三、项目分析器

```go
// ProjectAnalyzer 自动识别项目特征。
type ProjectAnalyzer struct {
    Root string
}

// Project 描述项目的关键信息。
type Project struct {
    Root       string
    Language   []string      // 主要语言: ["go", "typescript"]
    Frameworks []string      // 框架: ["react", "gin"]
    BuildTools []string      // 构建: ["go build", "vite"]
    TestTools  []string      // 测试: ["go test", "vitest"]
    Linters    []string      // Lint: ["golangci-lint", "eslint"]
    
    FileCount  int
    LineCount  int
    GitRepo    bool
    
    // 关键文件
    PackageFile string       // go.mod / package.json / Cargo.toml / etc.
    BuildFiles  []string     // Makefile / Dockerfile / CI config
    ConfigFiles []string     // 配置文件
    
    // 目录结构（树）
    DirectoryTree *DirNode
}
```

### 自动检测策略

```go
func (pa *ProjectAnalyzer) Analyze() (*Project, error) {
    p := &Project{Root: pa.Root}
    
    // 1. 扫描根目录关键文件
    entries, _ := os.ReadDir(pa.Root)
    for _, e := range entries {
        switch e.Name() {
        case "go.mod":
            p.Language = append(p.Language, "go")
            p.BuildTools = append(p.BuildTools, "go build")
            p.TestTools = append(p.TestTools, "go test")
            p.Linters = append(p.Linters, "golangci-lint")
            p.PackageFile = "go.mod"
        case "package.json":
            p.Language = append(p.Language, "typescript")
            // 检查是否有 vite/webpack/next 等
        case "Cargo.toml":
            p.Language = append(p.Language, "rust")
            p.BuildTools = append(p.BuildTools, "cargo build")
            p.TestTools = append(p.TestTools, "cargo test")
            p.PackageFile = "Cargo.toml"
        case "requirements.txt", "pyproject.toml", "setup.py":
            p.Language = append(p.Language, "python")
        case "Makefile":
            p.BuildFiles = append(p.BuildFiles, "Makefile")
        case "Dockerfile":
            p.BuildFiles = append(p.BuildFiles, "Dockerfile")
        case ".github":
            p.BuildFiles = append(p.BuildFiles, ".github/workflows/")
        }
    }
    
    // 2. 扫描目录结构（限制深度，避免 node_modules）
    p.DirectoryTree = pa.scanDir(pa.Root, 3)
    
    // 3. 统计代码量
    p.FileCount, p.LineCount = pa.countCode()
    
    // 4. 检查 Git
    p.GitRepo = isGitRepo(pa.Root)
    
    return p, nil
}
```

## 四、LSP 管理器

```go
// LSPManager 管理多个语言的 LSP 服务器进程。
type LSPManager struct {
    servers map[string]*LSPClient  // language → client
}

// LSPClient 封装一个 LSP 服务器连接。
type LSPClient struct {
    cmd      *exec.Cmd
    rpc      *jrpc2.Conn      // JSON-RPC 2.0
    language string
    
    // 缓存
    symbols    map[string][]SymbolInfo  // file → symbols
    diagnostics map[string][]Diagnostic // file → diagnostics
}

// 核心能力
func (m *LSPManager) Initialize(file string) error
func (m *LSPManager) GetSymbols(file string) ([]SymbolInfo, error)
func (m *LSPManager) GetHover(file string, line, col int) (*HoverInfo, error)
func (m *LSPManager) GetDefinition(file string, line, col int) (*Location, error)
func (m *LSPManager) GetReferences(file string, line, col int) ([]Location, error)
func (m *LSPManager) GetDiagnostics(file string) ([]Diagnostic, error)
func (m *LSPManager) GetCodeActions(file string, line, col int) ([]CodeAction, error)
func (m *LSPManager) FormatDocument(file string) ([]TextEdit, error)
```

### 支持的 LSP 服务器

```go
var lspConfigs = map[string]LSPConfig{
    "go": {
        Command: "gopls",
        Args:    []string{},
        Extensions: []string{".go"},
    },
    "typescript": {
        Command: "typescript-language-server",
        Args:    []string{"--stdio"},
        Extensions: []string{".ts", ".tsx", ".js", ".jsx"},
    },
    "javascript": {
        Command: "typescript-language-server",
        Args:    []string{"--stdio"},
        Extensions: []string{".js", ".jsx"},
    },
    "python": {
        Command: "pyright-langserver",
        Args:    []string{"--stdio"},
        Extensions: []string{".py"},
    },
    "rust": {
        Command: "rust-analyzer",
        Args:    []string{},
        Extensions: []string{".rs"},
    },
    // ... 更多语言
}
```

### LSP 自动选择策略

```go
// 根据工作区的文件扩展名分布自动启动相应的 LSP。
func (m *LSPManager) StartForWorkspace(root string) error {
    extCounts := countExtensions(root)
    total := sum(extCounts)
    
    for lang, cfg := range lspConfigs {
        // 如果该语言的扩展名占比超过 5%，启动对应的 LSP
        extTotal := 0
        for _, ext := range cfg.Extensions {
            extTotal += extCounts[ext]
        }
        if float64(extTotal) / float64(total) > 0.05 {
            m.Start(lang, root)
        }
    }
    return nil
}
```

## 五、代码索引器

### Tree-sitter 结构化索引

```go
// TreeSitterIndexer 使用 Tree-sitter 做 AST 级索引。
type TreeSitterIndexer struct {
    parsers map[string]*sitter.Parser // language → parser
}

// 索引结果
type CodeIndex struct {
    Symbols   []Symbol      // 函数、类型、变量定义
    Imports   []Import      // 导入列表
    Relations []Relation    // 调用关系、继承关系
}

type Symbol struct {
    Name     string
    Kind     SymbolKind   // function / class / interface / variable / const
    File     string
    Line     int
    Column   int
    Parent   string       // 父符号（如类的成员方法）
    Doc      string       // 文档注释
    Exported bool
}

type SymbolKind string
const (
    KindFunction  SymbolKind = "function"
    KindMethod    SymbolKind = "method"
    KindClass     SymbolKind = "class"
    KindInterface SymbolKind = "interface"
    KindStruct    SymbolKind = "struct"
    KindVariable  SymbolKind = "variable"
    KindConstant  SymbolKind = "constant"
    KindType      SymbolKind = "type"
    KindModule    SymbolKind = "module"
)
```

### 语义嵌入索引

```go
// EmbeddingIndexer 将代码片段嵌入向量空间，支持语义搜索。
type EmbeddingIndexer struct {
    embedder    Embedder
    vectorStore VectorStore
    chunkSize   int // 每个 chunk 的行数
}

// Index 将项目代码分块嵌入索引。
func (ei *EmbeddingIndexer) Index(root string) error {
    files, _ := discoverCodeFiles(root)
    for _, file := range files {
        chunks := chunkFile(file, ei.chunkSize) // 按逻辑边界分块（函数界）
        for _, chunk := range chunks {
            vec, err := ei.embedder.Embed(ctx, chunk.Code)
            if err != nil {
                continue
            }
            ei.vectorStore.Insert(ctx, chunk.ID, vec, map[string]any{
                "file":    file,
                "start_line": chunk.StartLine,
                "end_line":   chunk.EndLine,
                "symbol":     chunk.Symbol,
            })
        }
    }
    return nil
}

// Search 语义搜索代码片段。
func (ei *EmbeddingIndexer) Search(ctx context.Context, query string, topK int) ([]CodeChunk, error) {
    vec, err := ei.embedder.Embed(ctx, query)
    if err != nil {
        return nil, err
    }
    results, err := ei.vectorStore.Search(ctx, vec, topK)
    // 转换 SearchResult → CodeChunk
}
```

## 六、Git 上下文

```go
// GitContext 提供 Git 感知的上下文。
type GitContext struct {
    repoPath string
}

func (gc *GitContext) Status() ([]FileStatus, error)
func (gc *GitContext) Diff(stagedOnly bool, file string) (string, error)
func (gc *GitContext) Log(n int, file string) ([]Commit, error)
func (gc *GitContext) Blame(file string, line int) (*BlameInfo, error)

type FileStatus struct {
    Path      string
    Status    string   // M, A, D, R, ??
    Staged    bool
    Patch     string   // 变更内容
}

type Commit struct {
    Hash    string
    Author  string
    Date    time.Time
    Message string
    Files   []string
}
```

### 自动上下文注入

```go
// BuildSystemContext 构建系统上下文，自动注入到 System Prompt 中。
func BuildSystemContext(root string) string {
    var b strings.Builder
    
    // 1. 项目分析
    project := analyzeProject(root)
    b.WriteString(fmt.Sprintf("## 项目信息\n- 语言: %s\n- 框架: %s\n- 构建工具: %s\n\n",
        strings.Join(project.Language, ", "),
        strings.Join(project.Frameworks, ", "),
        strings.Join(project.BuildTools, ", ")))
    
    // 2. 目录结构（顶层）
    b.WriteString("## 目录结构\n```\n")
    b.WriteString(project.DirectoryTree.String(2))
    b.WriteString("\n```\n\n")
    
    // 3. Git 状态（如有变更）
    if gitCtx, err := NewGitContext(root); err == nil {
        if status, err := gitCtx.Status(); err == nil && len(status) > 0 {
            b.WriteString("## Git 状态\n")
            for _, f := range status {
                b.WriteString(fmt.Sprintf("- %s %s\n", f.Status, f.Path))
            }
            b.WriteString("\n")
        }
    }
    
    return b.String()
}
```

## 七、文件监听

```go
// FileWatcher 监听项目文件变更，实时更新索引。
type FileWatcher struct {
    watcher *fsnotify.Watcher
    onWrite func(file string) // 文件写入回调（触发重新索引）
}

func (fw *FileWatcher) Watch(root string, exclude []string) error {
    return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
        if info.IsDir() {
            // 排除 node_modules, .git, vendor, etc.
            for _, ex := range exclude {
                if info.Name() == ex { return filepath.SkipDir }
            }
            return fw.watcher.Add(path)
        }
        return nil
    })
}
```
