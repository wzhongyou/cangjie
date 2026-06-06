// Command cj is the CLI entry point for the Cangjie agent platform.
//
// Usage:
//
//	cj                          Launch interactive TUI mode.
//	cj [flags] "question"       Run a single-shot agent query.
//	cj server --port 9779       Start the API server.
//
// Cangjie is a unified AI agent platform — a single binary for CLI, TUI,
// API server, and multi-channel bot capabilities.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/wzhongyou/cangjie/agent"
	llmgateadapter "github.com/wzhongyou/cangjie/agent/llmgate"
	"github.com/wzhongyou/cangjie/tool/builtin"
	"github.com/wzhongyou/graphflow/graph"
	"github.com/wzhongyou/llmgate/sdk"
)

var (
	configPath  = flag.String("config", "", "Path to llmgate TOML config file")
	provider    = flag.String("provider", "", "Model provider to pin to (e.g. deepseek, openai, anthropic)")
	modelName   = flag.String("model", "", "Specific model ID override")
	workspace   = flag.String("workspace", ".", "Workspace root directory")
	maxSteps    = flag.Int("max-steps", 30, "Maximum agent execution steps")
	permission  = flag.String("permission", "ask", "Permission mode: strict, ask, loose")
	verbose     = flag.Bool("verbose", false, "Enable verbose output")
)

func main() {
	flag.Usage = usage
	flag.Parse()

	// Handle 'server' subcommand early.
	if flag.Arg(0) == "server" {
		runServer()
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	// Build the LLM model.
	llm := buildLLM()
	if llm == nil {
		log.Fatal("No LLM configured. Set up config/llmgate.toml or use environment variables.")
	}

	// Resolve workspace.
	wsRoot, err := filepath.Abs(*workspace)
	if err != nil {
		log.Fatalf("Invalid workspace: %v", err)
	}

	// Build tools.
	tools := buildTools(wsRoot)

	question := flag.Arg(0)

	if *verbose {
		fmt.Fprintf(os.Stderr, "Cangjie CLI\n")
		fmt.Fprintf(os.Stderr, "  workspace:  %s\n", wsRoot)
		fmt.Fprintf(os.Stderr, "  provider:   %s\n", orDefault(*provider, "auto"))
		fmt.Fprintf(os.Stderr, "  permission: %s\n", *permission)
		fmt.Fprintf(os.Stderr, "  max-steps:  %d\n", *maxSteps)
		fmt.Fprintf(os.Stderr, "  question:   %s\n\n", orDefault(question, "<interactive>"))
	}

	if question != "" {
		runSingleShot(ctx, llm, tools, wsRoot, question)
	} else {
		runInteractive(ctx, llm, tools, wsRoot)
	}
}

func runSingleShot(ctx context.Context, llm agent.LLMModel, tools []agent.Tool, wsRoot, question string) {
	startTime := time.Now()

	ag := agent.NewReActAgent(agent.ReActAgentConfig{
		Name:         "cj",
		LLM:          llm,
		SystemPrompt: buildSystemPrompt(wsRoot),
		Tools:        tools,
		MaxSteps:     *maxSteps,
	})

	g, err := ag.BuildGraph()
	if err != nil {
		log.Fatalf("Failed to build agent graph: %v", err)
	}

	engine := graph.NewEngine(g)
	result, err := engine.Run(ctx, &agent.MessageState{
		Messages: []agent.Message{{Role: agent.RoleUser, Content: question}},
		MaxSteps: *maxSteps,
	}, graph.WithHook(graph.ComposeHooks(&cliHook{verbose: *verbose})))
	if err != nil {
		if ctx.Err() != nil {
			fmt.Fprintf(os.Stderr, "\n[interrupted]\n")
		} else {
			fmt.Fprintf(os.Stderr, "\n[error] %v\n", err)
		}
		os.Exit(1)
	}

	duration := time.Since(startTime).Round(time.Millisecond)
	last := result.FinalState.Messages[len(result.FinalState.Messages)-1]

	fmt.Printf("\n%s\n", last.Content)
	fmt.Fprintf(os.Stderr, "\n[%d steps | %v | %d tokens]\n",
		result.TotalSteps, duration, result.FinalState.TotalTokens)
}

func runInteractive(ctx context.Context, llm agent.LLMModel, tools []agent.Tool, wsRoot string) {
	fmt.Println("Cangjie Interactive Mode")
	fmt.Println("Type your questions. Type /help for commands, /quit to exit.")
	fmt.Println()

	scanner := newLineScanner()
	for {
		fmt.Print("> ")
		line, ok := scanner.scan()
		if !ok {
			fmt.Println()
			break
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		switch {
		case line == "/quit" || line == "/exit":
			fmt.Println("Goodbye.")
			return
		case line == "/help":
			printHelp()
			continue
		case strings.HasPrefix(line, "/"):
			fmt.Printf("Unknown command: %s\nType /help for available commands.\n", line)
			continue
		}

		runSingleShot(ctx, llm, tools, wsRoot, line)
		fmt.Println()
	}
}

func runServer() {
	fmt.Println("Cangjie API Server")
	fmt.Println("(Server mode will be implemented in the next iteration.)")
	fmt.Println("Start with: cj server --port 9779")
}

// ── LLM setup ──────────────────────────────────────────────────────────────────

func buildLLM() agent.LLMModel {
	config := findConfig()

	gw, err := sdk.NewFromFile(config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not load config: %v\n", err)
		fmt.Fprintf(os.Stderr, "Trying environment variables...\n")
		gw = sdk.New()
	}

	if *modelName != "" {
		fmt.Fprintf(os.Stderr, "Using model: %s\n", *modelName)
	}
	if *provider != "" {
		fmt.Fprintf(os.Stderr, "Using provider: %s\n", *provider)
		return llmgateadapter.New(gw, llmgateadapter.Config{
			Provider: *provider,
			Model:    *modelName,
		})
	}

	if *modelName != "" {
		return llmgateadapter.New(gw, llmgateadapter.Config{Model: *modelName})
	}

	return llmgateadapter.NewWithStrategy(gw)
}

func findConfig() string {
	if *configPath != "" {
		return *configPath
	}
	for _, path := range []string{
		"config/llmgate.toml",
		"llmgate.toml",
		filepath.Join(os.Getenv("HOME"), ".cangjie", "config.toml"),
	} {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return "config/llmgate.toml" // Will error gracefully.
}

// ── Tools ──────────────────────────────────────────────────────────────────────

func buildTools(wsRoot string) []agent.Tool {
	return []agent.Tool{
		&builtin.CalculatorTool{},
		&builtin.FileTool{WorkspaceRoot: wsRoot},
		&builtin.ShellTool{WorkspaceRoot: wsRoot, MaxRuntime: 120 * time.Second},
		&builtin.GitTool{WorkspaceRoot: wsRoot},
	}
}

// ── System prompt ──────────────────────────────────────────────────────────────

func buildSystemPrompt(wsRoot string) string {
	hostname, _ := os.Hostname()
	return fmt.Sprintf(`You are Cangjie, an AI software engineering assistant.

You have access to tools for reading/writing files, executing shell commands,
and working with Git. Use them to understand and modify the codebase.

Current workspace: %s
Host: %s

Guidelines:
- Read files before editing them.
- Use the shell tool to run tests and builds.
- Make minimal, focused changes.
- If a command fails, analyze the error before retrying.
`, wsRoot, hostname)
}

// ── Hook ───────────────────────────────────────────────────────────────────────

type cliHook struct {
	verbose bool
	step    int
	start   time.Time
}

func (h *cliHook) OnGraphStart(_ context.Context, name string, _ *agent.MessageState) {
	h.start = time.Now()
	if h.verbose {
		fmt.Fprintf(os.Stderr, "[%s] starting...\n", name)
	}
}

func (h *cliHook) OnGraphEnd(_ context.Context, _ string, _ *agent.MessageState, err error) {
	if err != nil && h.verbose {
		fmt.Fprintf(os.Stderr, "[graph] error: %v\n", err)
	}
}

func (h *cliHook) OnNodeStart(_ context.Context, nodeName string, _ *agent.MessageState) {
	if h.verbose {
		fmt.Fprintf(os.Stderr, "  [%s]\n", nodeName)
	}
}

func (h *cliHook) OnNodeEnd(_ context.Context, nodeName string, s *agent.MessageState, err error, dur time.Duration) {
	if err != nil {
		if h.verbose {
			fmt.Fprintf(os.Stderr, "  [%s] error: %v\n", nodeName, err)
		}
		return
	}
	if len(s.Messages) == 0 {
		return
	}
	last := s.Messages[len(s.Messages)-1]

	if !h.verbose {
		switch {
		case len(last.ToolCalls) > 0:
			names := make([]string, len(last.ToolCalls))
			for i, tc := range last.ToolCalls {
				names[i] = tc.Name
			}
			fmt.Fprintf(os.Stderr, "  → %s\n", strings.Join(names, ", "))
		case last.Role == agent.RoleTool:
			preview := last.Content
			if len(preview) > 120 {
				preview = preview[:120] + "..."
			}
			fmt.Fprintf(os.Stderr, "    %s\n", strings.ReplaceAll(preview, "\n", "\n    "))
		}
		return
	}

	switch {
	case len(last.ToolCalls) > 0:
		for _, tc := range last.ToolCalls {
			fmt.Fprintf(os.Stderr, "  [tool] %s(%v)\n", tc.Name, tc.Arguments)
		}
	case last.Role == agent.RoleTool:
		fmt.Fprintf(os.Stderr, "  [result] %s\n", last.Content)
	default:
		fmt.Fprintf(os.Stderr, "  [llm] %s\n", last.Content)
	}
}

func (h *cliHook) OnRetry(_ context.Context, nodeName string, attempt int, lastErr error) {
	if h.verbose {
		fmt.Fprintf(os.Stderr, "  [retry] %s #%d: %v\n", nodeName, attempt, lastErr)
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────────

func usage() {
	fmt.Fprintf(os.Stderr, `Cangjie — Unified AI Agent Platform

Usage:
  cj [flags] "question"     Run a single-shot agent query.
  cj [flags]                 Launch interactive mode.
  cj server [flags]          Start the API server.

Flags:
`)
	flag.PrintDefaults()
	fmt.Fprintf(os.Stderr, `
Examples:
  cj "Add a health check endpoint to main.go"
  cj --provider deepseek "Explain the project structure"
  cj --workspace /path/to/project
  cj --verbose "Fix the failing test in auth_test.go"
`)
}

func printHelp() {
	fmt.Println(`Commands:
  /help          Show this help.
  /quit, /exit   Exit Cangjie.
  /clear         Clear the screen.

Just type your question to start an agent task.`)
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// ── Simple line scanner (stdlib only, no readline dependency) ──────────────────

type lineScanner struct {
	scanner *bufio.Scanner
}

func newLineScanner() *lineScanner {
	return &lineScanner{scanner: bufio.NewScanner(os.Stdin)}
}

func (ls *lineScanner) scan() (string, bool) {
	if ls.scanner.Scan() {
		return ls.scanner.Text(), true
	}
	return "", false
}
