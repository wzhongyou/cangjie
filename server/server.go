// Package server provides the HTTP + SSE API server for the
// Cangjie agent platform. It exposes agent execution, session management,
// and serves the AGUI web interface.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wzhongyou/cangjie/agent"
	"github.com/wzhongyou/cangjie/server/middleware"
	"github.com/wzhongyou/cangjie/session"
)

// Server is the Cangjie API server.
type Server struct {
	http     *http.Server
	agent    AgentRunner
	sessions *session.Store
}

// AgentRunner is the interface for executing agent tasks.
type AgentRunner interface {
	Run(ctx context.Context, state *agent.MessageState) (*agent.MessageState, error)
	RunStream(ctx context.Context, state *agent.MessageState, onEvent func(StreamEvent))
}

// StreamEvent is a single event during agent execution.
type StreamEvent struct {
	Type     string `json:"type"` // "thought", "tool_call", "tool_result", "answer", "done"
	Content  string `json:"content,omitempty"`
	ToolName string `json:"tool_name,omitempty"`
	Tokens   int    `json:"tokens,omitempty"`
}

// Config holds server configuration.
type Config struct {
	Port      int
	Host      string
	DataDir   string
}

// DefaultConfig returns reasonable defaults.
func DefaultConfig() Config {
	return Config{
		Port:    9779,
		Host:    "127.0.0.1",
		DataDir: "./data",
	}
}

// New creates a new Cangjie API server.
func New(runner AgentRunner, cfg Config) (*Server, error) {
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return nil, fmt.Errorf("server: data dir: %w", err)
	}

	store, err := session.NewStore(cfg.DataDir + "/cangjie.db")
	if err != nil {
		return nil, fmt.Errorf("server: session store: %w", err)
	}

	s := &Server{
		agent:    runner,
		sessions: store,
	}

	mux := http.NewServeMux()

	// ── AGUI static files ─────────────────────────────────────────────────
	aguiDir := "web/dist"
	if _, err := os.Stat(aguiDir); err == nil {
		mux.Handle("/", http.FileServer(http.Dir(aguiDir)))
		log.Printf("AGUI static files: %s", aguiDir)
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Write([]byte(aguiPlaceholder))
				return
			}
			http.NotFound(w, r)
		})
	}

	// ── API endpoints ─────────────────────────────────────────────────────
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/agent/chat", s.handleAgentChat)
	mux.HandleFunc("/api/sessions", s.handleSessionsList)
	mux.HandleFunc("/api/sessions/", s.handleSessionByID)

	// ── Middleware ─────────────────────────────────────────────────────────
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

	return s, nil
}

// Start begins listening and blocks.
func (s *Server) Start() error {
	log.Printf("AGUI: http://%s", s.http.Addr)
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
		"version": "0.3.0",
	})
}

func (s *Server) handleAgentChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		SessionID string `json:"session_id"`
		Message   string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	// ── SSE streaming ───────────────────────────────────────────────────
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sendSSE := func(event StreamEvent) {
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// Get or create session.
	sessionID := req.SessionID
	if sessionID == "" {
		sessionID = fmt.Sprintf("sess-%d", time.Now().UnixNano())
		title := req.Message
		if len(title) > 50 {
			title = title[:50] + "..."
		}
		s.sessions.CreateSession(&session.Session{
			ID:    sessionID,
			Title: title,
		})
	}

	// Build message state.
	messages := []agent.Message{}
	if sess, err := s.sessions.GetSession(sessionID); err == nil {
		messages = sess.Messages
	}
	userMsg := agent.Message{Role: agent.RoleUser, Content: req.Message}
	s.sessions.AddMessage(sessionID, userMsg)
	messages = append(messages, userMsg)

	// Collect assistant response for saving.
	var assistantContent strings.Builder

	s.agent.RunStream(r.Context(), &agent.MessageState{
		Messages: messages,
		MaxSteps: 30,
	}, func(ev StreamEvent) {
		switch ev.Type {
		case "answer":
			assistantContent.WriteString(ev.Content)
		case "done":
			if assistantContent.Len() > 0 {
				s.sessions.AddMessage(sessionID, agent.Message{
					Role:    agent.RoleAssistant,
					Content: assistantContent.String(),
				})
			}
		}
		sendSSE(ev)
	})
}

func (s *Server) handleSessionsList(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		sessions, err := s.sessions.ListSessions()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		type item struct {
			ID        string `json:"id"`
			Title     string `json:"title"`
			CreatedAt string `json:"created_at"`
		}
		items := make([]item, 0, len(sessions))
		for _, sess := range sessions {
			items = append(items, item{
				ID:        sess.ID,
				Title:     sess.Title,
				CreatedAt: sess.CreatedAt.Format(time.RFC3339),
			})
		}
		if items == nil {
			items = []item{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": items})

	case http.MethodPost:
		var req struct {
			Title     string `json:"title"`
			Workspace string `json:"workspace"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		id := fmt.Sprintf("sess-%d", time.Now().UnixNano())
		s.sessions.CreateSession(&session.Session{
			ID:            id,
			Title:         req.Title,
			WorkspaceRoot: req.Workspace,
		})
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})

	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleSessionByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "session id required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		sess, err := s.sessions.GetSession(id)
		if err != nil {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"session": map[string]any{
				"id":        sess.ID,
				"title":     sess.Title,
				"created_at": sess.CreatedAt.Format(time.RFC3339),
			},
			"messages": sess.Messages,
		})
	case http.MethodDelete:
		s.sessions.DeleteSession(id)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

const aguiPlaceholder = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Cangjie AGUI</title></head>
<body style="font-family:system-ui;max-width:800px;margin:80px auto;padding:20px;background:#0f172a;color:#e2e8f0">
<h1>Cangjie AGUI</h1>
<p>AGUI Web 前端尚未构建。请执行以下步骤：</p>
<pre style="background:#1e293b;padding:16px;border-radius:8px;color:#94a3b8">
cd web
npm install
npm run build
</pre>
<p>之后重启 <code>cj server</code> 即可访问完整界面。</p>
<p style="color:#64748b;margin-top:40px">API 端点可用：<br>
GET  /api/health<br>
POST /api/agent/chat<br>
GET  /api/sessions</p>
</body></html>`
