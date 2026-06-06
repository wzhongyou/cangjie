package permission

import (
	"context"
	"testing"
)

func TestPolicyEngine_DefaultAllow(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: PermFileRead,
		Path:       "/workspace/src/main.go",
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionAllow {
		t.Fatalf("expected Allow for workspace file read, got %s", decision)
	}
}

func TestPolicyEngine_DefaultAsk(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: PermFileWrite,
		Path:       "/workspace/src/main.go",
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionAsk {
		t.Fatalf("expected Ask for workspace file write, got %s", decision)
	}
}

func TestPolicyEngine_DenyDangerousShell(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: PermShellExec,
		Command:    "rm",
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionDeny {
		t.Fatalf("expected Deny for rm command, got %s", decision)
	}
}

func TestPolicyEngine_SudoDenied(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: PermShellExec,
		Command:    "sudo",
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionDeny {
		t.Fatalf("expected Deny for sudo command, got %s", decision)
	}
}

func TestPolicyEngine_AllowGitRead(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: PermGitRead,
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionAllow {
		t.Fatalf("expected Allow for git read, got %s", decision)
	}
}

func TestPolicyEngine_UnknownPermissionRequestsAsk(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: Permission("unknown:perm"),
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionAsk {
		t.Fatalf("expected Ask for unknown permission, got %s", decision)
	}
}

func TestPolicyEngine_LearnAlways(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	pe.Learn(DecisionRecord{
		Permission: PermGitWrite,
		Decision:   DecisionAllow,
		Scope:      ScopeAlways,
	})

	op := Operation{
		Permission: PermGitWrite,
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionAllow {
		t.Fatalf("expected Allow after learning, got %s", decision)
	}
}

func TestPolicyEngine_SystemDirWriteDenied(t *testing.T) {
	pe := NewPolicyEngine(DefaultPolicy("/workspace"))

	op := Operation{
		Permission: PermFileWrite,
		Path:       "/usr/local/bin/tool",
	}

	decision := pe.Check(context.Background(), op)
	if decision != DecisionDeny {
		t.Fatalf("expected Deny for system dir write, got %s", decision)
	}
}

func TestMatchDomain_Wildcard(t *testing.T) {
	if !matchDomain("*.example.com", "api.example.com") {
		t.Fatal("expected wildcard domain match")
	}
	if matchDomain("*.example.com", "example.com") {
		t.Fatal("expected wildcard domain to NOT match base domain")
	}
	if matchDomain("api.example.com", "other.example.com") {
		t.Fatal("expected exact domain to NOT match different subdomain")
	}
}

func TestMatchPath(t *testing.T) {
	if !matchPath("/workspace/**", "/workspace/src/main.go") {
		t.Fatal("expected glob path match")
	}
	if matchPath("/usr/**", "/workspace/main.go") {
		t.Fatal("expected /usr glob to NOT match workspace path")
	}
}
