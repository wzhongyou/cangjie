// structured_output demonstrates JSON Schema-constrained structured output.
//
// Usage:
//
//	go run ./examples/structured_output
//
// Runs in mock mode, no API key required.
package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/wzhongyou/cangjie/agent"
	"github.com/wzhongyou/graphflow/graph"
)

func main() {
	ctx := context.Background()

	// ── 1. Define the JSON Schema ───────────────────────────────────────────
	personSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{
				"type":        "string",
				"description": "Full name",
			},
			"age": map[string]any{
				"type":        "integer",
				"description": "Age in years",
			},
			"email": map[string]any{
				"type":        "string",
				"description": "Email address",
			},
		},
		"required": []string{"name", "age"},
	}

	// ── 2. Create an LLMNode with structured output ─────────────────────────
	llmNode := agent.NewLLMNode(agent.LLMNodeConfig{
		Model:  &jsonMockLLM{},
		Stream: false,
		StructuredOutput: &agent.StructuredOutputConfig{
			Schema:     personSchema,
			SchemaName: "Person",
		},
	})

	g := graph.NewGraph[*agent.MessageState]("structured-output-demo")
	g.AddNode("llm", llmNode.Run)
	g.SetEntryPoint("llm")
	g.Compile()

	engine := graph.NewEngine(g)

	// ── 3. Test 1: Valid JSON output ────────────────────────────────────────
	fmt.Println("=== Test 1: Valid JSON output ===")
	state := &agent.MessageState{
		Messages: []agent.Message{{Role: agent.RoleUser, Content: "Extract person information"}},
	}
	_, err := engine.Run(ctx, state)
	if err != nil {
		fmt.Printf("x Validation failed: %v\n", err)
	} else {
		last := state.Messages[len(state.Messages)-1]
		fmt.Printf("Passed validation\n%s\n", prettifyJSON(last.Content))
	}

	// ── 4. Test 2: Invalid output (missing required field) ───────────────────
	fmt.Println("\n=== Test 2: Missing required field (expect error) ===")
	llmNode2 := agent.NewLLMNode(agent.LLMNodeConfig{
		Model:  &invalidJSONMockLLM{},
		Stream: false,
		StructuredOutput: &agent.StructuredOutputConfig{
			Schema:     personSchema,
			SchemaName: "Person",
		},
	})
	g2 := graph.NewGraph[*agent.MessageState]("structured-output-demo-2")
	g2.AddNode("llm", llmNode2.Run)
	g2.SetEntryPoint("llm")
	g2.Compile()

	state2 := &agent.MessageState{
		Messages: []agent.Message{{Role: agent.RoleUser, Content: "Extract person information"}},
	}
	engine2 := graph.NewEngine(g2)
	_, err2 := engine2.Run(ctx, state2)
	if err2 != nil {
		fmt.Printf("Error caught as expected: %v\n", err2)
	}
}

func prettifyJSON(s string) string {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return s
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

// ── Mock LLM: returns valid JSON ────────────────────────────────────────────

type jsonMockLLM struct{}

func (m *jsonMockLLM) Chat(_ context.Context, req *agent.ChatRequest) (*agent.ChatResponse, error) {
	return &agent.ChatResponse{
		Content:      `{"name": "Alice", "age": 28, "email": "alice@example.com"}`,
		FinishReason: "stop",
	}, nil
}

func (m *jsonMockLLM) ChatStream(_ context.Context, req *agent.ChatRequest) (<-chan *agent.StreamChunk, error) {
	resp, err := m.Chat(context.Background(), req)
	if err != nil {
		return nil, err
	}
	ch := make(chan *agent.StreamChunk, 1)
	ch <- &agent.StreamChunk{Content: resp.Content, FinishReason: "stop"}
	close(ch)
	return ch, nil
}

// ── Mock LLM: returns invalid JSON (missing required field) ─────────────────

type invalidJSONMockLLM struct{}

func (m *invalidJSONMockLLM) Chat(_ context.Context, _ *agent.ChatRequest) (*agent.ChatResponse, error) {
	return &agent.ChatResponse{
		Content:      `{"age": 28}`,
		FinishReason: "stop",
	}, nil
}

func (m *invalidJSONMockLLM) ChatStream(_ context.Context, req *agent.ChatRequest) (<-chan *agent.StreamChunk, error) {
	resp, err := m.Chat(context.Background(), req)
	if err != nil {
		return nil, err
	}
	ch := make(chan *agent.StreamChunk, 1)
	ch <- &agent.StreamChunk{Content: resp.Content, FinishReason: "stop"}
	close(ch)
	return ch, nil
}
