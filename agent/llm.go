package agent

import "context"

// ChatRequest is the input to an LLM call.
type ChatRequest struct {
	Messages     []Message
	Tools        []ToolDef
	Temperature  *float64
	MaxTokens    *int
	ThinkingType string         // "disabled" to disable reasoning/thinking mode
	ResponseFormat map[string]any // JSON Schema for structured output; nil = no constraint
}

// ChatResponse is the output from a non-streaming LLM call.
type ChatResponse struct {
	Content          string
	ReasoningContent string
	ToolCalls        []ToolCall
	FinishReason     string
	Usage            *Usage
}

// Usage reports token consumption for a single LLM call.
type Usage struct {
	InputTokens  int
	OutputTokens int
	TotalTokens  int
}

// StreamChunk is a single piece of a streaming LLM response.
type StreamChunk struct {
	Content          string
	ReasoningContent string
	ToolCalls        []ToolCall
	FinishReason     string
	Usage            *Usage
	Error            error
}

// LLMModel is the interface every LLM backend must satisfy.
type LLMModel interface {
	Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error)
	ChatStream(ctx context.Context, req *ChatRequest) (<-chan *StreamChunk, error)
}

// Embedder converts text into a dense vector.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, error)
}

// VectorStore stores and retrieves embedded documents.
type VectorStore interface {
	Insert(ctx context.Context, id string, vector []float32, metadata map[string]any) error
	Search(ctx context.Context, query []float32, topK int) ([]SearchResult, error)
}

// SearchResult is a single hit from a vector search.
type SearchResult struct {
	ID       string
	Score    float32
	Metadata map[string]any
}

