// Package permission provides the permission system for the Cangjie agent platform.
//
// It defines the Permission model, decision types (allow/deny/ask), a policy
// engine for evaluating tool execution requests, and an audit trail for
// accountability and transparency.
package permission

import "time"

// Permission identifies a category of operation that requires authorization.
type Permission string

const (
	PermFileRead        Permission = "file:read"
	PermFileWrite       Permission = "file:write"
	PermShellExec       Permission = "shell:exec"
	PermNetworkOutbound Permission = "network:outbound"
	PermGitRead         Permission = "git:read"
	PermGitWrite        Permission = "git:write"
	PermPluginLoad      Permission = "plugin:load"
	PermConfigModify    Permission = "config:modify"
)

// Decision is the result of a permission check.
type Decision string

const (
	DecisionAllow Decision = "allow"
	DecisionDeny  Decision = "deny"
	DecisionAsk   Decision = "ask"
)

// Scope controls how long a permission decision is remembered.
type Scope string

const (
	ScopeOnce    Scope = "once"    // Apply to this single operation only.
	ScopeSession Scope = "session" // Apply for the duration of the current session.
	ScopeAlways  Scope = "always"  // Persist across all future sessions.
)

// DecisionRecord captures a single permission decision for audit and learning.
type DecisionRecord struct {
	Permission Permission
	Decision   Decision
	Scope      Scope
	Reason     string
	Timestamp  time.Time
}
