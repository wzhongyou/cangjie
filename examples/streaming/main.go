// streaming_demo demonstrates streaming response capabilities with Cangjie.
//
// Usage:
//
//	go run ./examples/streaming
//
// Demonstrates:
//  1. LLMNode.OnChunk — token-by-token streaming output
//  2. Engine.RunStream — streaming graph execution events (node start/end)
//
// Runs in mock mode, no API key required.
package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wzhongyou/cangjie/agent"
	"github.com/wzhongyou/graphflow/graph"
)

func main() {
	ctx := context.Background()

	// ── 1. Create an LLMNode with streaming support ──────────────────────────
	llmNode := agent.NewLLMNode(agent.LLMNodeConfig{
		Model:  &streamingMockLLM{},
		Stream: true,
		OnChunk: func(chunk *agent.StreamChunk) {
			if chunk.Content != "" {
				fmt.Print(chunk.Content)
			}
		},
	})

	// ── 2. Build the graph ───────────────────────────────────────────────────
	g := graph.NewGraph[*agent.MessageState]("streaming-demo")
	g.AddNode("llm", llmNode.Run)
	g.SetEntryPoint("llm")
	g.Compile()

	engine := graph.NewEngine(g)

	// ── 3. Method 1: OnChunk real-time token output ──────────────────────────
	fmt.Println("=== OnChunk: Token-by-token streaming ===")
	state := &agent.MessageState{
		Messages: []agent.Message{{Role: agent.RoleUser, Content: "Introduce yourself"}},
	}
	_, err := engine.Run(ctx, state)
	if err != nil {
		panic(err)
	}
	fmt.Println("\nStreaming complete.")
	fmt.Printf("Total tokens: %d\n\n", state.TotalTokens)

	// ── 4. Method 2: RunStream graph execution events ────────────────────────
	fmt.Println("=== RunStream: Graph execution event stream ===")
	state2 := &agent.MessageState{
		Messages: []agent.Message{{Role: agent.RoleUser, Content: "Hello"}},
	}

	stream, err := engine.RunStream(ctx, state2)
	if err != nil {
		panic(err)
	}

	for event := range stream.Chan() {
		switch event.Type {
		case graph.StreamNodeStart:
			fmt.Printf("▶ Node started: %s\n", event.NodeName)
		case graph.StreamNodeEnd:
			fmt.Printf("■ Node ended: %s (%v)\n", event.NodeName, event.Duration)
		case graph.StreamGraphEnd:
			fmt.Println("◆ Graph execution complete")
		}
	}
}

// ── Mock streaming LLM ──────────────────────────────────────────────────────

type streamingMockLLM struct{}

func (m *streamingMockLLM) Chat(_ context.Context, req *agent.ChatRequest) (*agent.ChatResponse, error) {
	return &agent.ChatResponse{
		Content:      "This is a streaming response. Each word is output in real time via the OnChunk callback.",
		FinishReason: "stop",
	}, nil
}

func (m *streamingMockLLM) ChatStream(_ context.Context, _ *agent.ChatRequest) (<-chan *agent.StreamChunk, error) {
	ch := make(chan *agent.StreamChunk, 20)
	go func() {
		words := strings.Fields("This is a streaming response. Each word is output in real time via the OnChunk callback.")
		for _, word := range words {
			ch <- &agent.StreamChunk{Content: word + " "}
			time.Sleep(100 * time.Millisecond)
		}
		ch <- &agent.StreamChunk{
			Content:      "",
			FinishReason: "stop",
			Usage:        &agent.Usage{InputTokens: 10, OutputTokens: 12, TotalTokens: 22},
		}
		close(ch)
	}()
	return ch, nil
}
