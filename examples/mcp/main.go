// mcp_demo demonstrates MCP client connectivity — discovering and calling
// tools through the Model Context Protocol.
//
// Usage:
//
//	go run ./examples/mcp -cmd "npx" -args "-y,@modelcontextprotocol/server-everything"
//
// This connects to the MCP "everything" reference server, lists tools, and
// calls the echo tool. You can also connect any stdio-based MCP server.
//
// Requirements:
//   - Go 1.21+
//   - If using an external MCP server, the corresponding runtime (Node.js, Python, etc.)
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/wzhongyou/cangjie/agent"
)

func main() {
	cmd := flag.String("cmd", "", "MCP server command (e.g. npx, python)")
	args := flag.String("args", "", "MCP server arguments (comma-separated)")
	flag.Parse()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	if *cmd != "" {
		runWithExternalMCP(ctx, *cmd, parseArgs(*args))
	} else {
		runWithDemoMCP(ctx)
	}
}

func parseArgs(s string) []string {
	if s == "" {
		return nil
	}
	return []string{s}
}

func runWithExternalMCP(ctx context.Context, command string, args []string) {
	fmt.Printf("Connecting to MCP server: %s %v\n", command, args)

	adapter, err := agent.NewMCPClientAdapter(command, args...)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create MCP client: %v\n", err)
		os.Exit(1)
	}
	defer adapter.Close()

	if err := adapter.Connect(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to connect to MCP server: %v\n", err)
		os.Exit(1)
	}

	tools := adapter.Tools()
	fmt.Printf("Found %d tools:\n", len(tools))
	for _, tool := range tools {
		fmt.Printf("  - %s: %s\n", tool.Name(), tool.Description())
	}

	if len(tools) > 0 {
		tool := tools[0]
		fmt.Printf("\nCalling tool: %s\n", tool.Name())
		result, err := tool.Execute(ctx, map[string]any{})
		if err != nil {
			fmt.Printf("Call failed: %v\n", err)
		} else {
			fmt.Printf("Result: %s\n", result)
		}
	}
}

func runWithDemoMCP(ctx context.Context) {
	fmt.Println("=== MCP Client Demo ===")
	fmt.Println()
	fmt.Println("Usage: go run ./examples/mcp -cmd \"<mcp-server-command>\" -args \"<args>\"")
	fmt.Println()
	fmt.Println("Example: go run ./examples/mcp -cmd \"npx\" -args \"-y,@modelcontextprotocol/server-everything\"")
	fmt.Println()
	fmt.Println("Or use any stdio MCP server:")
	fmt.Println("  go run ./examples/mcp -cmd \"python\" -args \"-m,mcp_server\"")
	fmt.Println()

	fmt.Println("── MCPClientAdapter API ──")
	fmt.Println("1. adapter, err := agent.NewMCPClientAdapter(command, args...)")
	fmt.Println("2. err := adapter.Connect(ctx)")
	fmt.Println("3. tools := adapter.Tools()  // returns []agent.Tool")
	fmt.Println("4. result, err := tool.Execute(ctx, args)")
	fmt.Println("5. adapter.Close()")
	fmt.Println()
	fmt.Println("The returned tools can be directly passed to a ReActAgent:")
	fmt.Println("  agent.NewReActAgent(agent.ReActAgentConfig{")
	fmt.Println("    Tools: adapter.Tools(),")
	fmt.Println("  })")
}
