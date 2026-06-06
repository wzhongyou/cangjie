package permission

import "time"

// AuditEntry records a single permission-checked operation for audit purposes.
type AuditEntry struct {
	ID        string
	SessionID string
	Timestamp time.Time

	// Operation details.
	ToolName   string
	Permission Permission
	Target     string         // The specific target (path, command, domain).
	Args       map[string]any // Tool arguments (sanitized).

	// Decision.
	Decision  Decision
	Scope     Scope
	UserInput string // User response when DecisionAsk was presented.

	// Outcome.
	Result   string        // Success or error message.
	Duration time.Duration // Execution duration.
	Error    string        // Non-empty if the operation failed.
}

// AuditLogger persists audit entries for later review.
type AuditLogger interface {
	// Log records a single audit entry.
	Log(entry AuditEntry) error

	// Query retrieves audit entries matching the given filter.
	Query(filter AuditFilter) ([]AuditEntry, error)
}

// AuditFilter defines criteria for querying audit entries.
type AuditFilter struct {
	SessionID  string
	Permission Permission
	Decision   Decision
	ToolName   string
	After      time.Time
	Before     time.Time
	Limit      int
}

// NoOpAuditLogger is an AuditLogger that discards all entries.
type NoOpAuditLogger struct{}

func (n *NoOpAuditLogger) Log(_ AuditEntry) error              { return nil }
func (n *NoOpAuditLogger) Query(_ AuditFilter) ([]AuditEntry, error) { return nil, nil }
