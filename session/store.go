package session

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"github.com/wzhongyou/cangjie/agent"
)

// Store persists sessions and messages using SQLite.
type Store struct {
	mu sync.RWMutex
	db *sql.DB
}

// NewStore creates a new session store backed by SQLite at the given path.
// The database and schema are created automatically if they do not exist.
func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("session store: open: %w", err)
	}

	db.SetMaxOpenConns(1) // SQLite serialized mode.
	db.SetConnMaxLifetime(0)

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("session store: migrate: %w", err)
	}

	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS sessions (
		id         TEXT PRIMARY KEY,
		title      TEXT NOT NULL DEFAULT '',
		model      TEXT NOT NULL DEFAULT '',
		workspace  TEXT NOT NULL DEFAULT '',
		step_count INTEGER NOT NULL DEFAULT 0,
		total_tokens INTEGER NOT NULL DEFAULT 0,
		status     TEXT NOT NULL DEFAULT 'active',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS messages (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		role       TEXT NOT NULL,
		content    TEXT NOT NULL DEFAULT '',
		tool_calls TEXT DEFAULT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
	`
	_, err := db.Exec(schema)
	return err
}

// Close releases the database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

// CreateSession creates a new session and returns it.
func (s *Store) CreateSession(session *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if session.ID == "" {
		return fmt.Errorf("session store: session ID is required")
	}
	if session.CreatedAt.IsZero() {
		session.CreatedAt = time.Now()
	}
	session.UpdatedAt = session.CreatedAt

	_, err := s.db.Exec(
		`INSERT INTO sessions (id, title, model, workspace, step_count, total_tokens, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		session.ID, session.Title, session.Model, session.WorkspaceRoot,
		session.StepCount, session.TotalTokens, string(session.Status),
		session.CreatedAt.UTC().Format(time.RFC3339),
		session.UpdatedAt.UTC().Format(time.RFC3339),
	)
	return err
}

// GetSession retrieves a session by ID.
func (s *Store) GetSession(id string) (*Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(
		`SELECT id, title, model, workspace, step_count, total_tokens, status, created_at, updated_at
		 FROM sessions WHERE id = ?`, id)

	sess := &Session{}
	var status, createdAt, updatedAt string
	err := row.Scan(&sess.ID, &sess.Title, &sess.Model, &sess.WorkspaceRoot,
		&sess.StepCount, &sess.TotalTokens, &status, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("session %q not found", id)
	}
	if err != nil {
		return nil, fmt.Errorf("session store: get: %w", err)
	}

	sess.Status = Status(status)
	sess.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	sess.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)

	// Load messages.
	sess.Messages, _ = s.getMessages(id)

	return sess, nil
}

// UpdateSession updates session metadata.
func (s *Store) UpdateSession(session *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session.UpdatedAt = time.Now()
	_, err := s.db.Exec(
		`UPDATE sessions SET title=?, step_count=?, total_tokens=?, status=?, updated_at=? WHERE id=?`,
		session.Title, session.StepCount, session.TotalTokens, string(session.Status),
		session.UpdatedAt.UTC().Format(time.RFC3339), session.ID,
	)
	return err
}

// ListSessions returns all sessions ordered by most recent first.
func (s *Store) ListSessions() ([]*Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(
		`SELECT id, title, model, workspace, step_count, total_tokens, status, created_at, updated_at
		 FROM sessions ORDER BY updated_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*Session
	for rows.Next() {
		sess := &Session{}
		var status, createdAt, updatedAt string
		if err := rows.Scan(&sess.ID, &sess.Title, &sess.Model, &sess.WorkspaceRoot,
			&sess.StepCount, &sess.TotalTokens, &status, &createdAt, &updatedAt); err != nil {
			continue
		}
		sess.Status = Status(status)
		sess.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		sess.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)
		sessions = append(sessions, sess)
	}
	return sessions, nil
}

// DeleteSession removes a session and its messages.
func (s *Store) DeleteSession(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// ── Messages ──────────────────────────────────────────────────────────────────

// AddMessage appends a message to a session.
func (s *Store) AddMessage(sessionID string, msg agent.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var toolCallsJSON *string
	if len(msg.ToolCalls) > 0 {
		data, _ := json.Marshal(msg.ToolCalls)
		s := string(data)
		toolCallsJSON = &s
	}

	_, err := s.db.Exec(
		`INSERT INTO messages (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)`,
		sessionID, string(msg.Role), msg.Content, toolCallsJSON,
	)

	// Touch session updated_at.
	s.db.Exec(`UPDATE sessions SET updated_at=? WHERE id=?`,
		time.Now().UTC().Format(time.RFC3339), sessionID)

	return err
}

func (s *Store) getMessages(sessionID string) ([]agent.Message, error) {
	rows, err := s.db.Query(
		`SELECT role, content, tool_calls FROM messages WHERE session_id = ? ORDER BY id ASC`,
		sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []agent.Message
	for rows.Next() {
		var role, content string
		var toolCallsJSON *string
		if err := rows.Scan(&role, &content, &toolCallsJSON); err != nil {
			continue
		}

		msg := agent.Message{
			Role:    agent.Role(role),
			Content: content,
		}
		if toolCallsJSON != nil {
			json.Unmarshal([]byte(*toolCallsJSON), &msg.ToolCalls)
		}

		msgs = append(msgs, msg)
	}
	return msgs, nil
}

// GetMessages returns all messages for a session.
func (s *Store) GetMessages(sessionID string) ([]agent.Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.getMessages(sessionID)
}
