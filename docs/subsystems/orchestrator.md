# Agent 编排器详细设计

## 一、设计目标

统一 Agent 编排接口，支持多种执行模式，从简单 ReAct 到复杂的多 Agent 协作。所有模式基于 Graphflow 图引擎实现。

## 二、编排器接口

```go
// Orchestrator 是统一的 Agent 编排入口。
type Orchestrator struct {
    mode    OrchestrationMode
    graph   *graph.Graph[*MessageState]
    engine  *graph.Engine[*MessageState]
    config  OrchestratorConfig
}

// OrchestratorConfig 编排器配置。
type OrchestratorConfig struct {
    Mode        OrchestrationMode
    
    // LLM
    LLM         LLMModel
    SystemPrompt string
    
    // 工具
    Tools       []Tool
    MCPConfigs  []MCPConfig
    ToolSets    map[string][]string // agent_name → tool_names
    
    // 规划
    Planner     Planner
    
    // 反射
    Reflector   Reflector
    
    // 限制
    MaxSteps    int
    MaxTime     time.Duration
    
    // 回调
    OnStep      func(step StepInfo)
    OnError     func(err error)
}
```

## 三、编排模式

### 3.1 ReAct（思考-行动循环）

最简单的模式，Agent 在每个步骤中：思考 → 调用工具 → 观察结果 → 再思考。

```go
// ReActOrchestrator 实现经典的 Reason-Act 循环。
// 图结构:
//   llm ──(has tool calls)──→ tool ──→ llm (循环)
//    │                          
//    └──(no tool calls)──→ end

type ReActOrchestrator struct {
    llmNode  *agent.LLMNode
    toolNode *agent.ToolNode
    graph    *graph.Graph[*MessageState]
}

func NewReActOrchestrator(cfg ReActConfig) *ReActOrchestrator {
    llmNode := NewLLMNode(LLMNodeConfig{
        Model:        cfg.LLM,
        SystemPrompt: cfg.SystemPrompt,
        Tools:        cfg.Tools,
    })
    toolNode := NewToolNode(cfg.Tools...)
    
    g := graph.NewGraph[*MessageState]("react")
    g.AddNode("llm", llmNode.Run)
    g.AddNode("tool", toolNode.Run)
    g.SetEntryPoint("llm")
    g.AddCondition("llm", graph.Condition[*MessageState]{
        If: HasPendingToolCalls, Target: "tool",
    })
    g.AddEdge("tool", "llm")
    g.SetMaxIterations("llm", cfg.MaxSteps)
    g.Compile()
    
    return &ReActOrchestrator{llmNode, toolNode, g}
}
```

**适用场景**：简单的代码修改、文件查询、单步任务

### 3.2 Plan-Execute（计划-执行-验证）

先分析生成执行计划，用户确认后批量执行，最后验证结果。

```go
// PlanExecuteOrchestrator 实现计划-执行-验证循环。
// 图结构:
//   plan → [user confirm] → execute_1 → execute_2 → ... → verify
//                                                           │
//                            ┌──────────────────────────────┘
//                            ▼
//                    (need fix)→ fix → verify (循环)
//                     (all good)→ end

type PlanExecuteOrchestrator struct {
    planner   *PlannerNode
    executors []*ExecutorNode
    verifier  *VerifierNode
}

// Plan 执行计划。
type Plan struct {
    Steps []PlanStep `json:"steps"`
    Goal  string     `json:"goal"`
}

type PlanStep struct {
    ID          string   `json:"id"`
    Description string   `json:"description"`
    Tool        string   `json:"tool"`
    Args        map[string]any `json:"args"`
    Expected    string   `json:"expected"`     // 预期结果
    DependsOn   []string `json:"depends_on"`   // 依赖的前置步骤
}

// PlannerNode 分析用户意图，生成执行计划。
type PlannerNode struct {
    llm LLMModel
}

func (n *PlannerNode) Run(ctx context.Context, s *MessageState) (*MessageState, error) {
    // 使用结构化输出约束 LLM 返回 Plan JSON
    resp, err := n.llm.Chat(ctx, &ChatRequest{
        Messages: s.Messages,
        ResponseFormat: planSchema,
    })
    
    var plan Plan
    json.Unmarshal([]byte(resp.Content), &plan)
    
    if s.Context == nil {
        s.Context = make(map[string]any)
    }
    s.Context["plan"] = plan
    s.Context["plan_status"] = "pending_confirm"
    
    s.Messages = append(s.Messages, Message{
        Role:    RoleAssistant,
        Content: fmt.Sprintf("执行计划：\n%s", formatPlan(plan)),
    })
    
    return s, nil
}

// VerifierNode 验证执行结果是否符合预期。
type VerifierNode struct {
    llm LLMModel
}

func (n *VerifierNode) Run(ctx context.Context, s *MessageState) (*MessageState, error) {
    plan := s.Context["plan"].(Plan)
    
    resp, err := n.llm.Chat(ctx, &ChatRequest{
        Messages: []Message{{
            Role: RoleUser,
            Content: fmt.Sprintf(
                "验证以下计划是否完全执行成功：\n计划: %v\n执行结果: %v\n\n返回: passed 或 failed（附原因）",
                plan, s.Messages[len(s.Messages)-1].Content,
            ),
        }},
    })
    
    if strings.Contains(resp.Content, "passed") {
        s.Context["plan_status"] = "completed"
    } else {
        s.Context["plan_status"] = "needs_fix"
        s.Context["fix_hint"] = resp.Content
    }
    
    return s, nil
}
```

**适用场景**：复杂多文件修改、新增功能、重构

### 3.3 Multi-Agent（多 Agent 协作）

```go
// MultiAgentOrchestrator 编排多个专业化 Agent。
// 图结构:
//   router → [classify task]
//          ├──→ code_agent ──→ merge
//          ├──→ test_agent ──→ merge
//          ├──→ review_agent ─→ merge
//          └──→ doc_agent ───→ merge
//                                   │
//                                   ▼
//                              supervisor ──→ (need more) → router
//                                         └─→ (done) → end

type MultiAgentOrchestrator struct {
    agents    map[string]Agent     // 专业化 Agent 池
    router    *RouterNode
    supervisor *SupervisorNode
    merger    *MergeNode
}

// 专业化 Agent 示例：
var defaultAgents = map[string]AgentConfig{
    "code_writer": {
        SystemPrompt: "你是代码编写专家...",
        Tools: []string{"file_write", "file_edit", "shell_exec"},
    },
    "code_reviewer": {
        SystemPrompt: "你是代码审查专家...",
        Tools: []string{"file_read", "git_diff", "lsp_diagnostics"},
    },
    "test_writer": {
        SystemPrompt: "你是测试编写专家...",
        Tools: []string{"file_read", "file_write", "test_run"},
    },
    "doc_writer": {
        SystemPrompt: "你是文档编写专家...",
        Tools: []string{"file_read", "file_write"},
    },
}
```

**适用场景**：大型功能开发、全面代码审查、跨领域任务

### 3.4 Human-Loop（人机协同）

```go
// HumanLoopOrchestrator 在关键步骤暂停，等待人类确认。
// 图结构:
//   agent_step_1 → [critical?] → [wait human] → continue
//                 → [normal] → agent_step_2 → ...

type HumanLoopOrchestrator struct {
    agent        Orchestrator
    criticalOps  map[string]bool // 需要人类确认的操作类型
}

// 触发 HITL 的条件：
//   - 修改 3 个以上文件
//   - 执行 git commit / push
//   - 安装新依赖
//   - 删除文件
//   - 修改配置文件
//   - 超过 $100 的 API 调用
func (h *HumanLoopOrchestrator) ShouldPause(step StepInfo) bool {
    if step.ToolCall.Name == "git_commit" { return true }
    if step.ToolCall.Name == "git_push"   { return true }
    if step.ToolCall.Name == "file_write" && step.FilesAffected >= 3 { return true }
    if step.ToolCall.Name == "shell_exec" && strings.Contains(step.ToolArgs["command"].(string), "install") { return true }
    return false
}
```

## 四、图编排可视化

每种编排模式都生成 Graphviz DOT 格式的图可视化：

```go
func (o *Orchestrator) Visualize() string {
    return o.graph.ToDOT()
}

// 输出示例：
// digraph ReAct {
//   rankdir=LR;
//   llm -> tool [label="has tool calls"];
//   tool -> llm;
//   llm -> end [label="no tool calls"];
// }
```

## 五、模式自动选择

```go
// AutoSelect 根据任务复杂度和用户偏好自动选择编排模式。
func AutoSelect(task string, config OrchestratorConfig) OrchestrationMode {
    // 简单检测规则
    task = strings.ToLower(task)
    
    // 多 Agent 触发词
    multiAgentKeywords := []string{
        "全面", "完整", "整套", "整个系统",
        "同时做", "并行", "分配",
        "all", "full", "complete", "entire",
    }
    for _, kw := range multiAgentKeywords {
        if strings.Contains(task, kw) {
            return ModeMultiAgent
        }
    }
    
    // Plan-Execute 触发词
    planKeywords := []string{
        "重构", "迁移", "升级", "添加功能", "新增模块",
        "refactor", "migrate", "upgrade", "implement", "add feature",
    }
    for _, kw := range planKeywords {
        if strings.Contains(task, kw) {
            return ModePlanExecute
        }
    }
    
    // 默认 ReAct
    return ModeReAct
}
```
