package memory

import (
	"context"
	"fmt"

	"github.com/wzhongyou/cangjie/agent"
)

// LongTermMemory persists and retrieves memories via a VectorStore.
type LongTermMemory struct {
	embedder    agent.Embedder
	vectorStore agent.VectorStore
}

// NewLongTermMemory creates a long-term memory backed by the given stores.
func NewLongTermMemory(embedder agent.Embedder, store agent.VectorStore) *LongTermMemory {
	return &LongTermMemory{embedder: embedder, vectorStore: store}
}

// Remember embeds and stores a memory string.
func (m *LongTermMemory) Remember(ctx context.Context, text string, metadata map[string]any) error {
	if m.embedder == nil || m.vectorStore == nil {
		return fmt.Errorf("long-term memory: embedder and vectorStore must be set")
	}
	vector, err := m.embedder.Embed(ctx, text)
	if err != nil {
		return fmt.Errorf("embedding: %w", err)
	}
	// Generate a unique memory ID derived from the embedding vector.
	id := fmt.Sprintf("mem-%x", vector[:min(8, len(vector))])
	return m.vectorStore.Insert(ctx, id, vector, metadata)
}

// Recall retrieves the top-k most relevant memories for a query.
func (m *LongTermMemory) Recall(ctx context.Context, query string, topK int) ([]agent.SearchResult, error) {
	if m.embedder == nil || m.vectorStore == nil {
		return nil, fmt.Errorf("long-term memory: embedder and vectorStore must be set")
	}
	vector, err := m.embedder.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("embedding: %w", err)
	}
	return m.vectorStore.Search(ctx, vector, topK)
}
