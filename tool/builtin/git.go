package builtin

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/wzhongyou/cangjie/tool"
)

// GitTool provides Git version control operations: status, diff, log, add, commit.
type GitTool struct {
	WorkspaceRoot string // Repository root directory.
}

// Ensure GitTool implements tool.Tool and tool.SafeTool.
var _ tool.Tool = (*GitTool)(nil)
var _ tool.SafeTool = (*GitTool)(nil)

func (g *GitTool) Name() string { return "git" }
func (g *GitTool) Description() string {
	return "Perform Git operations: status, diff, log, add files, and commit changes. Read operations are always allowed; writes require confirmation."
}
func (g *GitTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{
				"type":        "string",
				"enum":        []string{"status", "diff", "log", "add", "commit", "branch", "checkout"},
				"description": "Git operation: status (working tree status), diff (show changes), log (commit history), add (stage files), commit (create commit), branch (list/create branches), checkout (switch branches).",
			},
			"files": map[string]any{
				"type":        "string",
				"description": "File paths to operate on (add action). Space-separated for multiple files.",
			},
			"message": map[string]any{
				"type":        "string",
				"description": "Commit message (commit action).",
			},
			"branch": map[string]any{
				"type":        "string",
				"description": "Branch name (branch create, checkout actions).",
			},
			"staged": map[string]any{
				"type":        "boolean",
				"description": "Show staged changes only (diff action).",
			},
		},
		"required": []string{"action"},
	}
}

func (g *GitTool) IsReadOnly() bool { return false }
func (g *GitTool) RequiredPermissions() []tool.Permission {
	return []tool.Permission{tool.PermGitRead, tool.PermGitWrite}
}
func (g *GitTool) AffectedPaths(args map[string]any) []string {
	if files, ok := args["files"].(string); ok {
		return strings.Fields(files)
	}
	return nil
}

func (g *GitTool) Execute(ctx context.Context, args map[string]any) (string, error) {
	action, _ := args["action"].(string)

	switch action {
	case "status":
		return g.git(ctx, "status", "--short")
	case "diff":
		staged, _ := args["staged"].(bool)
		if staged {
			return g.git(ctx, "diff", "--staged")
		}
		return g.git(ctx, "diff")
	case "log":
		return g.git(ctx, "log", "--oneline", "-20")
	case "add":
		files, _ := args["files"].(string)
		if files == "" {
			return "", fmt.Errorf("git add: 'files' argument is required")
		}
		fileList := strings.Fields(files)
		allArgs := append([]string{"add"}, fileList...)
		return g.git(ctx, allArgs...)
	case "commit":
		message, _ := args["message"].(string)
		if message == "" {
			return "", fmt.Errorf("git commit: 'message' argument is required")
		}
		return g.git(ctx, "commit", "-m", message)
	case "branch":
		branch, _ := args["branch"].(string)
		if branch != "" {
			return g.git(ctx, "branch", branch)
		}
		return g.git(ctx, "branch")
	case "checkout":
		branch, _ := args["branch"].(string)
		if branch == "" {
			return "", fmt.Errorf("git checkout: 'branch' argument is required")
		}
		return g.git(ctx, "checkout", branch)
	default:
		return "", fmt.Errorf("git: unknown action %q", action)
	}
}

func (g *GitTool) git(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if g.WorkspaceRoot != "" {
		cmd.Dir = g.WorkspaceRoot
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, string(output))
	}

	result := strings.TrimSpace(string(output))
	if result == "" {
		return "(no output)", nil
	}
	return result, nil
}
