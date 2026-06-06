// Package server provides the HTTP + WebSocket API server for the
// Cangjie agent platform. It exposes agent execution, session management,
// and real-time streaming endpoints.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/wzhongyou/cangjie/agent"
	"github.com/wzhongyou/cangjie/server/middleware"
)

// Server is the Cangjie API server.
type Server struct {
	http     *http.Server
	agent    AgentRunner
	sessions *SessionManager
}

// AgentRunner is the interface for executing agent tasks.
type AgentRunner interface {
	Run(ctx context.Context, input string) (*AgentResult, error)
	RunStream(ctx context.Context, input string) (<-chan *StreamEvent, error)
}

// AgentResult is the outcome of an agent execution.
type AgentResult struct {
	Content    string `json:"content"`
	Steps      int    `json:"steps"`
	TokensUsed int    `json:"tokens_used"`
	Duration   string `json:"duration"`
}

// StreamEvent is a single event in a streaming agent execution.
type StreamEvent struct {
	Type     string `json:"type"` // "thought", "tool_call", "tool_result", "answer", "error"
	Content  string `json:"content"`
	ToolName string `json:"tool_name,omitempty"`
	Tokens   int    `json:"tokens,omitempty"`
}

// SessionManager tracks active sessions.
type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*agent.MessageState
}

// NewSessionManager creates a new session manager.
func NewSessionManager() *SessionManager {
	return &SessionManager{sessions: make(map[string]*agent.MessageState)}
}

// Get returns the session state for the given ID.
func (sm *SessionManager) Get(id string) (*agent.MessageState, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	s, ok := sm.sessions[id]
	return s, ok
}

// Set stores the session state.
func (sm *SessionManager) Set(id string, state *agent.MessageState) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.sessions[id] = state
}

// Config holds server configuration.
type Config struct {
	Port      int
	Host      string
	AuthToken string
}

// DefaultConfig returns a reasonable default configuration.
func DefaultConfig() Config {
	return Config{
		Port: 9779,
		Host: "127.0.0.1",
	}
}

// New creates a new Cangjie API server.
func New(runner AgentRunner, cfg Config) *Server {
	s := &Server{
		agent:    runner,
		sessions: NewSessionManager(),
	}

	mux := http.NewServeMux()

	// REST endpoints.
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/agent/run", s.handleAgentRun)
	mux.HandleFunc("/api/sessions", s.handleSessions)

	// WebSocket for streaming — handled inline as SSE for now.
	mux.HandleFunc("/api/stream", s.handleStream)

	// Middleware stack.
	var handler http.Handler = mux
	handler = middleware.CORS(handler)
	handler = middleware.Logging(handler)

	s.http = &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 10 * time.Minute,
		IdleTimeout:  120 * time.Second,
	}

	return s
}

// Start begins listening and blocks until the server is stopped.
func (s *Server) Start() error {
	log.Printf("Cangjie API server listening on %s", s.http.Addr)
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": "0.2.0",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleAgentRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Input     string `json:"input"`
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Input == "" {
		writeError(w, http.StatusBadRequest, "input is required")
		return
	}

	ctx := r.Context()
	result, err := s.agent.Run(ctx, req.Input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"sessions": []string{},
		})
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "session id required")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": id})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "WebSocket streaming coming soon")
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
