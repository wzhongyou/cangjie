// Package tool provides the core tool abstractions for the Cangjie agent platform.
//
// It defines the Tool interface that every tool must implement, a ToolRegistry for
// managing named tools, and the SafeTool extension for tools that declare security
// and permission metadata.
package tool

import "context"

// Tool is the interface for any capability an agent can invoke.
type Tool interface {
	// Name returns the unique identifier for this tool.
	Name() string

	// Description returns a human-readable explanation of what the tool does.
	Description() string

	// Parameters returns a JSON Schema describing the tool's argument object.
	Parameters() map[string]any

	// Execute runs the tool with the given arguments and returns a result string.
	Execute(ctx context.Context, args map[string]any) (string, error)
}

// SafeTool extends Tool with security metadata. Tools that implement SafeTool
// declare the permissions they require and which filesystem paths they affect,
// enabling the permission system to make informed decisions.
type SafeTool interface {
	Tool

	// IsReadOnly returns true if the tool never modifies external state.
	IsReadOnly() bool

	// RequiredPermissions returns the permissions needed to execute this tool.
	RequiredPermissions() []Permission

	// AffectedPaths returns the filesystem paths this tool may read or write,
	// given the specific arguments. Returns nil if the paths are unknown.
	AffectedPaths(args map[string]any) []string
}

// Permission is a string identifier for an operation category.
type Permission string

const (
	PermFileRead        Permission = "file:read"
	PermFileWrite       Permission = "file:write"
	PermShellExec       Permission = "shell:exec"
	PermNetworkOutbound Permission = "network:outbound"
	PermGitRead         Permission = "git:read"
	PermGitWrite        Permission = "git:write"
)

// ToolDef describes a tool available to an LLM.
type ToolDef struct {
	Name        string
	Description string
	Parameters  map[string]any // JSON Schema for the tool's arguments
}

// ToolDefs extracts ToolDef values from a slice of Tools.
func ToolDefs(tools []Tool) []ToolDef {
	defs := make([]ToolDef, len(tools))
	for i, t := range tools {
		defs[i] = ToolDef{
			Name:        t.Name(),
			Description: t.Description(),
			Parameters:  t.Parameters(),
		}
	}
	return defs
}

// ToolRegistry holds named tools available to agent nodes.
type ToolRegistry struct {
	tools map[string]Tool
}

// NewToolRegistry creates an empty registry.
func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{tools: make(map[string]Tool)}
}

// Register adds a tool to the registry.
func (r *ToolRegistry) Register(t Tool) { r.tools[t.Name()] = t }

// Get retrieves a tool by name.
func (r *ToolRegistry) Get(name string) (Tool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

// List returns all registered tools.
func (r *ToolRegistry) List() []Tool {
	out := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t)
	}
	return out
}

// Len returns the number of registered tools.
func (r *ToolRegistry) Len() int { return len(r.tools) }
