package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Store persists sessions and provides CRUD operations.
// The default implementation uses JSON files on disk.
// A SQLite backend will be added in a future phase.
type Store struct {
	mu   sync.RWMutex
	dir  string
}

// NewStore creates a new session store at the given directory path.
// The directory is created if it does not exist.
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("session store: %w", err)
	}
	return &Store{dir: dir}, nil
}

// Save persists a session to disk.
func (s *Store) Save(session *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session.UpdatedAt = time.Now()
	if session.CreatedAt.IsZero() {
		session.CreatedAt = session.UpdatedAt
	}

	data, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return fmt.Errorf("session store: marshal: %w", err)
	}

	path := s.sessionPath(session.ID)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("session store: write: %w", err)
	}

	return nil
}

// Load retrieves a session from disk.
func (s *Store) Load(id string) (*Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	path := s.sessionPath(id)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("session %q not found", id)
		}
		return nil, fmt.Errorf("session store: read: %w", err)
	}

	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, fmt.Errorf("session store: unmarshal: %w", err)
	}

	return &session, nil
}

// List returns all saved sessions.
func (s *Store) List() ([]*Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("session store: readdir: %w", err)
	}

	var sessions []*Session
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(s.dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var session Session
		if err := json.Unmarshal(data, &session); err != nil {
			continue
		}
		sessions = append(sessions, &session)
	}

	return sessions, nil
}

// Delete removes a session from disk.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := s.sessionPath(id)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("session store: delete: %w", err)
	}
	return nil
}

func (s *Store) sessionPath(id string) string {
	return filepath.Join(s.dir, id+".json")
}
