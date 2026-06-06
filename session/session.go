// Package session provides session management for the Cangjie agent platform.
//
// It supports persistent sessions, checkpoints for rollback, branching for
// experimentation, and context compression for long-running conversations.
package session

import (
	"time"

	"github.com/wzhongyou/cangjie/agent"
)

// Status represents the current state of a session.
type Status string

const (
	StatusActive    Status = "active"
	StatusPaused    Status = "paused"
	StatusCompleted Status = "completed"
	StatusAborted   Status = "aborted"
)

// Session represents a single agent conversation.
type Session struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Messages  []agent.Message `json:"messages"`

	// Metadata.
	WorkspaceRoot string `json:"workspace_root"`
	Model         string `json:"model"`
	TotalTokens   int    `json:"total_tokens"`
	StepCount     int    `json:"step_count"`
	Status        Status `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Checkpoint is a snapshot of session state at a point in time.
type Checkpoint struct {
	ID        string    `json:"id"`
	StepCount int       `json:"step_count"`
	MessageID string    `json:"message_id"`
	State     []byte    `json:"state"` // JSON-serialized agent state.
	CreatedAt time.Time `json:"created_at"`
}

// Branch represents a session branch created from a checkpoint.
type Branch struct {
	ID           string `json:"id"`
	ParentID     string `json:"parent_id"`
	CheckpointID string `json:"checkpoint_id"`
	Name         string `json:"name"`
}
