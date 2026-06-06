package permission

import (
	"context"
	"path/filepath"
	"strings"
)

// Operation describes a tool execution context for permission checking.
type Operation struct {
	Permission Permission
	ToolName   string
	Command    string   // For shell operations.
	Path       string   // For file operations.
	Domain     string   // For network operations.
	Args       map[string]any
}

// PolicyRule defines a single permission rule.
type PolicyRule struct {
	Permission  Permission
	PathPattern string // Glob pattern for file paths.
	Command     string // Command name for shell operations.
	Domain      string // Domain name for network operations.
	Decision    Decision
	Reason      string
	Priority    int // Lower numbers are checked first.
}

// PolicyEngine evaluates operations against a set of rules and learned decisions.
type PolicyEngine struct {
	rules    []PolicyRule
	learned  map[string]DecisionRecord // keyed by a composite key of permission+target.
}

// NewPolicyEngine creates a PolicyEngine with the given rule set.
func NewPolicyEngine(rules []PolicyRule) *PolicyEngine {
	pe := &PolicyEngine{
		rules:   rules,
		learned: make(map[string]DecisionRecord),
	}

	// Sort rules by priority (lower = higher priority).
	sortRules(pe.rules)

	return pe
}

// Check evaluates whether the given operation should be allowed.
// It returns the decision (Allow, Deny, or Ask).
func (pe *PolicyEngine) Check(_ context.Context, op Operation) Decision {
	// 1. Check learned decisions (always-scoped) first.
	key := learnedKey(op)
	if record, ok := pe.learned[key]; ok && record.Scope == ScopeAlways {
		return record.Decision
	}

	// 2. Match against policy rules in priority order.
	for _, rule := range pe.rules {
		if pe.match(rule, op) {
			return rule.Decision
		}
	}

	// 3. Default: ask the user.
	return DecisionAsk
}

// Learn records a user's decision for future reference.
func (pe *PolicyEngine) Learn(record DecisionRecord) {
	key := permissionTargetKey(record.Permission, "")
	if record.Scope == ScopeAlways {
		pe.learned[key] = record
	}
}

// match checks if a rule applies to the given operation.
func (pe *PolicyEngine) match(rule PolicyRule, op Operation) bool {
	if rule.Permission != op.Permission {
		return false
	}

	switch op.Permission {
	case PermFileRead, PermFileWrite:
		return matchPath(rule.PathPattern, op.Path)
	case PermShellExec:
		return matchCommand(rule.Command, op.Command)
	case PermNetworkOutbound:
		return matchDomain(rule.Domain, op.Domain)
	default:
		return true // Match on permission alone for generic permissions.
	}
}

func matchPath(pattern, path string) bool {
	if pattern == "" {
		return false
	}

	// Handle ** (double-star) as "match anything under this directory".
	if strings.Contains(pattern, "**") {
		prefix := strings.TrimSuffix(pattern, "/**")
		prefix = strings.TrimSuffix(prefix, "**")
		// Exact match of prefix dir, or path starts with prefix/.
		if path == prefix {
			return true
		}
		if strings.HasPrefix(path, prefix+"/") {
			return true
		}
		// Also try filepath.Match as fallback for simpler patterns.
	}

	matched, _ := filepath.Match(pattern, path)
	return matched
}

func matchCommand(ruleCmd, opCmd string) bool {
	if ruleCmd == "" {
		return false
	}
	return strings.EqualFold(ruleCmd, opCmd) ||
		strings.HasPrefix(opCmd, ruleCmd)
}

func matchDomain(ruleDomain, opDomain string) bool {
	if ruleDomain == "" {
		return false
	}
	// Support wildcard: *.example.com matches api.example.com
	if strings.HasPrefix(ruleDomain, "*.") {
		suffix := ruleDomain[1:] // .example.com
		return strings.HasSuffix(opDomain, suffix)
	}
	return opDomain == ruleDomain
}

func learnedKey(op Operation) string {
	return permissionTargetKey(op.Permission, opTarget(op))
}

func permissionTargetKey(p Permission, target string) string {
	return string(p) + ":" + target
}

func opTarget(op Operation) string {
	switch op.Permission {
	case PermFileRead, PermFileWrite:
		return op.Path
	case PermShellExec:
		return op.Command
	case PermNetworkOutbound:
		return op.Domain
	default:
		return ""
	}
}

// DefaultPolicy returns a reasonable default policy for agent operations.
func DefaultPolicy(workspace string) []PolicyRule {
	return []PolicyRule{
		// Project workspace: allow reads, ask for writes.
		{Permission: PermFileRead, PathPattern: filepath.Join(workspace, "**"), Decision: DecisionAllow, Priority: 100},
		{Permission: PermFileWrite, PathPattern: filepath.Join(workspace, "**"), Decision: DecisionAsk, Priority: 100},

		// Hidden files: always ask.
		{Permission: PermFileWrite, PathPattern: filepath.Join(workspace, ".**"), Decision: DecisionAsk, Priority: 150},

		// System directories: read-only.
		{Permission: PermFileRead, PathPattern: "/usr/**", Decision: DecisionAllow, Priority: 200},
		{Permission: PermFileWrite, PathPattern: "/usr/**", Decision: DecisionDeny, Priority: 200},

		// Dangerous shell commands: always deny.
		{Permission: PermShellExec, Command: "rm", Decision: DecisionDeny, Priority: 10},
		{Permission: PermShellExec, Command: "sudo", Decision: DecisionDeny, Priority: 10},
		{Permission: PermShellExec, Command: "chmod", Decision: DecisionAsk, Priority: 10},

		// Git: allow reads, ask for writes.
		{Permission: PermGitRead, Decision: DecisionAllow, Priority: 300},
		{Permission: PermGitWrite, Decision: DecisionAsk, Priority: 300},

		// Network: allow known API domains.
		{Permission: PermNetworkOutbound, Domain: "api.openai.com", Decision: DecisionAllow, Priority: 400},
		{Permission: PermNetworkOutbound, Domain: "api.anthropic.com", Decision: DecisionAllow, Priority: 400},
		{Permission: PermNetworkOutbound, Domain: "api.github.com", Decision: DecisionAllow, Priority: 400},
	}
}

// sortRules sorts rules by priority. Simple insertion sort for small N.
func sortRules(rules []PolicyRule) {
	for i := 1; i < len(rules); i++ {
		j := i
		for j > 0 && rules[j].Priority < rules[j-1].Priority {
			rules[j], rules[j-1] = rules[j-1], rules[j]
			j--
		}
	}
}
