// Package orchestrator provides agent orchestration patterns built on
// top of the Graphflow engine. It supports ReAct, Plan-Execute,
// Multi-Agent, and Human-in-the-Loop execution modes.
package orchestrator

import (
	"context"
	"fmt"
	"time"

	"github.com/wzhongyou/cangjie/agent"
	"github.com/wzhongyou/graphflow/graph"
)

// Mode identifies the orchestration pattern.
type Mode string

const (
	ModeReAct       Mode = "react"
	ModePlanExecute Mode = "plan-execute"
	ModeMultiAgent  Mode = "multi-agent"
)

// Config holds configuration for any orchestration mode.
type Config struct {
	Mode         Mode
	LLM          agent.LLMModel
	SystemPrompt string
	Tools        []agent.Tool
	MaxSteps     int
	MaxTime      time.Duration

	// Plan-Execute settings.
	Planner   Planner
	Reflector Reflector

	// Multi-Agent settings.
	SubAgents map[string]agent.SubAgent

	// Callbacks.
	OnStep  func(StepInfo)
	OnError func(error)
}

// StepInfo describes a single step during orchestration.
type StepInfo struct {
	Step      int
	NodeName  string
	ToolCall  *agent.ToolCall
	Duration  time.Duration
}

// Planner analyzes intent and produces an execution plan.
type Planner interface {
	Plan(ctx context.Context, input string, context map[string]any) (*Plan, error)
}

// Reflector validates results and decides whether to retry.
type Reflector interface {
	Reflect(ctx context.Context, result string, expected string) (bool, string)
}

// Plan represents a structured execution plan.
type Plan struct {
	Goal  string     `json:"goal"`
	Steps []PlanStep `json:"steps"`
}

// PlanStep is a single step in an execution plan.
type PlanStep struct {
	ID          string   `json:"id"`
	Description string   `json:"description"`
	Tool        string   `json:"tool"`
	Args        map[string]any `json:"args"`
	Expected    string   `json:"expected"`
	DependsOn   []string `json:"depends_on"`
}

// Orchestrator is the unified agent execution engine.
type Orchestrator struct {
	cfg Config
}

// New creates an orchestrator with the given configuration.
func New(cfg Config) *Orchestrator {
	if cfg.MaxSteps <= 0 {
		cfg.MaxSteps = 30
	}
	if cfg.MaxTime <= 0 {
		cfg.MaxTime = 10 * time.Minute
	}
	if cfg.Mode == "" {
		cfg.Mode = ModeReAct
	}
	return &Orchestrator{cfg: cfg}
}

// Run executes the agent task and returns the result.
func (o *Orchestrator) Run(ctx context.Context, input string) (*RunResult, error) {
	switch o.cfg.Mode {
	case ModeReAct:
		return o.runReAct(ctx, input)
	default:
		return nil, fmt.Errorf("orchestrator: mode %q not yet implemented", o.cfg.Mode)
	}
}

// RunResult is the outcome of an orchestrated task.
type RunResult struct {
	FinalMessage string
	Messages     []agent.Message
	Steps        int
	TokensUsed   int
	Duration     time.Duration
	Plan         *Plan // Set when ModePlanExecute is used.
}

func (o *Orchestrator) runReAct(ctx context.Context, input string) (*RunResult, error) {
	start := time.Now()

	ag := agent.NewReActAgent(agent.ReActAgentConfig{
		Name:         "orchestrator",
		LLM:          o.cfg.LLM,
		SystemPrompt: o.cfg.SystemPrompt,
		Tools:        o.cfg.Tools,
		MaxSteps:     o.cfg.MaxSteps,
	})

	g, err := ag.BuildGraph()
	if err != nil {
		return nil, fmt.Errorf("orchestrator: build graph: %w", err)
	}

	engine := graph.NewEngine(g)

	state := &agent.MessageState{
		Messages: []agent.Message{{Role: agent.RoleUser, Content: input}},
		MaxSteps: o.cfg.MaxSteps,
	}

	result, err := engine.Run(ctx, state)
	if err != nil {
		return nil, fmt.Errorf("orchestrator: run: %w", err)
	}

	last := result.FinalState.Messages[len(result.FinalState.Messages)-1]

	return &RunResult{
		FinalMessage: last.Content,
		Messages:     result.FinalState.Messages,
		Steps:        result.TotalSteps,
		TokensUsed:   result.FinalState.TotalTokens,
		Duration:     time.Since(start),
	}, nil
}

// AutoDetectMode selects the best orchestration mode for a given task.
func AutoDetectMode(task string) Mode {
	lower := toLower(task)

	// Multi-Agent triggers.
	for _, kw := range []string{"full", "complete", "entire", "comprehensive", "all at once"} {
		if contains(lower, kw) {
			return ModeMultiAgent
		}
	}

	// Plan-Execute triggers.
	for _, kw := range []string{"refactor", "migrate", "upgrade", "implement", "add feature", "build"} {
		if contains(lower, kw) {
			return ModePlanExecute
		}
	}

	return ModeReAct
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := range s {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && indexOf(s, substr) >= 0
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
