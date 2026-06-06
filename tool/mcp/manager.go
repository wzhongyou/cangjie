package mcp

import (
	"context"
	"fmt"
	"sync"

	"github.com/wzhongyou/cangjie/tool"
)

// ServerProcess describes a managed MCP server process.
type ServerProcess struct {
	Name    string
	Command string
	Args    []string
	adapter *ClientAdapter
}

// Manager manages the lifecycle of multiple MCP server processes.
// It handles discovery, startup, shutdown, and tool aggregation across
// all connected MCP servers.
type Manager struct {
	mu      sync.RWMutex
	servers map[string]*ServerProcess
}

// NewManager creates an empty MCP Manager.
func NewManager() *Manager {
	return &Manager{
		servers: make(map[string]*ServerProcess),
	}
}

// AddServer starts a new MCP server process with the given configuration.
// A unique name must be provided for later reference.
func (m *Manager) AddServer(ctx context.Context, name, command string, args ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.servers[name]; exists {
		return fmt.Errorf("mcp: server %q already exists", name)
	}

	adapter, err := NewClientAdapter(command, args...)
	if err != nil {
		return fmt.Errorf("mcp: add server %q: %w", name, err)
	}

	if err := adapter.Connect(ctx); err != nil {
		adapter.Close()
		return fmt.Errorf("mcp: connect server %q: %w", name, err)
	}

	m.servers[name] = &ServerProcess{
		Name:    name,
		Command: command,
		Args:    args,
		adapter: adapter,
	}

	return nil
}

// RemoveServer stops and removes a previously added MCP server.
func (m *Manager) RemoveServer(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	srv, exists := m.servers[name]
	if !exists {
		return fmt.Errorf("mcp: server %q not found", name)
	}

	if err := srv.adapter.Close(); err != nil {
		return fmt.Errorf("mcp: close server %q: %w", name, err)
	}

	delete(m.servers, name)
	return nil
}

// Tools returns all tools from all connected MCP servers.
func (m *Manager) Tools() []tool.Tool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var all []tool.Tool
	for _, srv := range m.servers {
		all = append(all, srv.adapter.Tools()...)
	}
	return all
}

// Servers returns the names of all managed servers.
func (m *Manager) Servers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	names := make([]string, 0, len(m.servers))
	for name := range m.servers {
		names = append(names, name)
	}
	return names
}

// Close shuts down all managed MCP servers.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var errs []error
	for name, srv := range m.servers {
		if err := srv.adapter.Close(); err != nil {
			errs = append(errs, fmt.Errorf("mcp: close %q: %w", name, err))
		}
	}
	m.servers = make(map[string]*ServerProcess)

	if len(errs) > 0 {
		return fmt.Errorf("mcp: shutdown errors: %v", errs)
	}
	return nil
}
