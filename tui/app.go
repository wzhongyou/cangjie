// Package tui provides the terminal user interface for the Cangjie agent
// platform, built with the Bubble Tea framework.
//
// It provides an interactive chat experience with Markdown rendering,
// streaming output, diff previews, and permission confirmation dialogs.
package tui

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
)

// Model represents the main application state.
type Model struct {
	// Input handling.
	input    strings.Builder
	cursor   int

	// Messages.
	messages []Message

	// State.
	mode     Mode
	quitting bool
	err      error

	// Dimensions.
	width  int
	height int

	// Agent connection (injected).
	runner  AgentRunner
	ctx     context.Context
}

// Message is a single chat message for display.
type Message struct {
	Role    string // "user", "assistant", "system", "tool"
	Content string
}

// Mode is the current UI mode.
type Mode int

const (
	ModeInput  Mode = iota // Waiting for user input.
	ModeThinking           // Agent is thinking.
	ModeConfirm            // Waiting for permission confirmation.
)

// AgentRunner is the interface for executing agent tasks from the TUI.
type AgentRunner interface {
	Run(ctx context.Context, input string) (*RunResult, error)
}

// RunResult is the outcome of an agent execution for display.
type RunResult struct {
	Content    string
	Steps      int
	TokensUsed int
}

// New creates a new TUI model.
func New(runner AgentRunner) *Model {
	return &Model{
		mode:   ModeInput,
		runner: runner,
		ctx:    context.Background(),
	}
}

// Run starts the TUI application loop.
// This is a simplified non-Bubble-Tea version for Phase 2.
// Full Bubble Tea integration will be added in a future phase.
func (m *Model) Run() error {
	fmt.Println("Cangjie TUI (simplified mode)")
	fmt.Println("Type your questions. Enter /quit to exit.")
	fmt.Println()

	scanner := &lineReader{reader: os.Stdin}
	for !m.quitting {
		fmt.Print("> ")
		line, ok := scanner.readLine()
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
			m.quitting = true
			fmt.Println("Goodbye.")
			continue
		case line == "/help":
			printHelp()
			continue
		}

		// Add user message.
		m.messages = append(m.messages, Message{Role: "user", Content: line})

		// Run agent.
		fmt.Println("Thinking...")
		result, err := m.runner.Run(m.ctx, line)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			continue
		}

		// Add assistant response.
		m.messages = append(m.messages, Message{Role: "assistant", Content: result.Content})
		fmt.Println(result.Content)
		fmt.Printf("\n[%d steps | %d tokens]\n\n", result.Steps, result.TokensUsed)
	}

	return nil
}

func printHelp() {
	fmt.Println(`Commands:
  /help     Show this help.
  /quit     Exit Cangjie.
  /clear    Clear the screen.`)
}

type lineReader struct {
	reader io.Reader
	buf    []byte
}

func (lr *lineReader) readLine() (string, bool) {
	lr.buf = lr.buf[:0]
	b := make([]byte, 1)
	for {
		_, err := lr.reader.Read(b)
		if err != nil {
			return string(lr.buf), len(lr.buf) > 0
		}
		if b[0] == '\n' {
			return string(lr.buf), true
		}
		lr.buf = append(lr.buf, b[0])
	}
}
