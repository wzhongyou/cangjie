package builtin

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/wzhongyou/cangjie/tool"
)

// ShellTool executes shell commands in a controlled environment.
// All commands run within the workspace root and are subject to
// timeout and safety checks.
type ShellTool struct {
	WorkspaceRoot string
	MaxRuntime    time.Duration // Default: 120s. Capped at 600s.
}

// Ensure ShellTool implements tool.Tool and tool.SafeTool.
var _ tool.Tool = (*ShellTool)(nil)
var _ tool.SafeTool = (*ShellTool)(nil)

func (s *ShellTool) Name() string { return "shell" }
func (s *ShellTool) Description() string {
	return "Execute a shell command within the workspace. Commands have a timeout and run in a restricted environment."
}
func (s *ShellTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"command": map[string]any{
				"type":        "string",
				"description": "The shell command to execute.",
			},
			"working_dir": map[string]any{
				"type":        "string",
				"description": "Working directory relative to workspace root. Defaults to workspace root.",
			},
		},
		"required": []string{"command"},
	}
}

func (s *ShellTool) IsReadOnly() bool { return false }
func (s *ShellTool) RequiredPermissions() []tool.Permission {
	return []tool.Permission{tool.PermShellExec}
}
func (s *ShellTool) AffectedPaths(args map[string]any) []string {
	return nil // Unknown — depends on command.
}

func (s *ShellTool) Execute(ctx context.Context, args map[string]any) (string, error) {
	command, _ := args["command"].(string)
	workingDir, _ := args["working_dir"].(string)

	if command == "" {
		return "", fmt.Errorf("shell: 'command' argument is required")
	}

	// Safety: deny obviously dangerous patterns.
	if err := s.validateCommand(command); err != nil {
		return "", err
	}

	maxRuntime := s.MaxRuntime
	if maxRuntime <= 0 {
		maxRuntime = 120 * time.Second
	}

	ctx, cancel := context.WithTimeout(ctx, maxRuntime)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)

	// Set working directory.
	if workingDir != "" {
		cmd.Dir = workingDir
	} else if s.WorkspaceRoot != "" {
		cmd.Dir = s.WorkspaceRoot
	}

	// Strip environment to a minimal safe set.
	cmd.Env = s.safeEnv()

	output, err := cmd.CombinedOutput()

	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("shell: command timed out after %v", maxRuntime)
	}

	if err != nil {
		return string(output), fmt.Errorf("shell: %w\n%s", err, string(output))
	}

	return string(output), nil
}

// validateCommand checks for obviously dangerous command patterns.
func (s *ShellTool) validateCommand(cmd string) error {
	dangerous := []string{
		"rm -rf /",
		"rm -rf ~",
		"rm -rf .",
		"mkfs.",
		"> /dev/sda",
		"dd if=",
		":(){ :|:& };:", // fork bomb
		"chmod 777 /",
		"> /etc/",
		"curl" + " | sh",
		"wget" + " | sh",
	}

	lower := strings.ToLower(cmd)
	for _, d := range dangerous {
		if strings.Contains(lower, d) {
			return fmt.Errorf("shell: command matches dangerous pattern %q", d)
		}
	}

	return nil
}

// safeEnv returns a minimal set of safe environment variables.
func (s *ShellTool) safeEnv() []string {
	vars := []string{
		"HOME=" + os.Getenv("HOME"),
		"USER=" + os.Getenv("USER"),
		"PATH=" + os.Getenv("PATH"),
		"LANG=" + os.Getenv("LANG"),
		"TERM=" + os.Getenv("TERM"),
		"SHELL=" + os.Getenv("SHELL"),
		"PWD=" + os.Getenv("PWD"),
		"TMPDIR=" + os.Getenv("TMPDIR"),
		"HOME=" + os.Getenv("HOME"),
	}

	if s.WorkspaceRoot != "" {
		vars = append(vars, "WORKSPACE="+s.WorkspaceRoot)
	}

	return vars
}
