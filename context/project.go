// Package context provides project analysis and code understanding
// capabilities for the Cangjie agent platform.
//
// It discovers project structure, programming languages, frameworks,
// and build systems, and provides Git-aware context for the agent.
package context

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Project describes key information about a codebase.
type Project struct {
	Root       string   `json:"root"`
	Languages  []string `json:"languages"`
	Frameworks []string `json:"frameworks"`
	BuildTools []string `json:"build_tools"`
	TestTools  []string `json:"test_tools"`
	Linters    []string `json:"linters"`

	FileCount     int  `json:"file_count"`
	LineCount     int  `json:"line_count"`
	IsGitRepo     bool `json:"is_git_repo"`

	PackageFile string   `json:"package_file"`
	BuildFiles  []string `json:"build_files"`
	ConfigFiles []string `json:"config_files"`

	DirectoryTree *DirNode `json:"directory_tree"`
}

// DirNode represents an entry in the project directory tree.
type DirNode struct {
	Name     string    `json:"name"`
	IsDir    bool      `json:"is_dir"`
	Children []*DirNode `json:"children,omitempty"`
}

// AnalysisOptions controls project analysis behavior.
type AnalysisOptions struct {
	MaxDepth       int      // Maximum directory depth to scan.
	ExcludeDirs    []string // Directories to skip.
	MaxFiles       int      // Maximum files to count (for large projects).
}

// DefaultAnalysisOptions returns sensible defaults.
func DefaultAnalysisOptions() AnalysisOptions {
	return AnalysisOptions{
		MaxDepth:    4,
		ExcludeDirs: []string{".git", "node_modules", "vendor", ".cangjie", "__pycache__", "target", "dist", "build"},
		MaxFiles:    100000,
	}
}

// Analyze scans the given directory and returns a Project description.
func Analyze(root string, opts AnalysisOptions) (*Project, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("context: resolve root: %w", err)
	}

	p := &Project{
		Root: root,
	}

	// Scan top-level entries for package/build files.
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("context: read root: %w", err)
	}

	for _, e := range entries {
		name := e.Name()
		switch {
		case name == "go.mod":
			p.Languages = appendUnique(p.Languages, "Go")
			p.BuildTools = appendUnique(p.BuildTools, "go build")
			p.TestTools = appendUnique(p.TestTools, "go test")
			p.Linters = appendUnique(p.Linters, "golangci-lint")
			p.PackageFile = "go.mod"
		case name == "go.sum":
			// Companion file to go.mod.
		case name == "package.json":
			p.Languages = appendUnique(p.Languages, "TypeScript/JavaScript")
			p.BuildTools = appendUnique(p.BuildTools, "npm/yarn")
			p.TestTools = appendUnique(p.TestTools, "jest/vitest")
			p.PackageFile = "package.json"
		case name == "Cargo.toml":
			p.Languages = appendUnique(p.Languages, "Rust")
			p.BuildTools = appendUnique(p.BuildTools, "cargo build")
			p.TestTools = appendUnique(p.TestTools, "cargo test")
			p.PackageFile = "Cargo.toml"
		case name == "requirements.txt" || name == "pyproject.toml" || name == "setup.py":
			p.Languages = appendUnique(p.Languages, "Python")
			if name == "pyproject.toml" {
				p.PackageFile = "pyproject.toml"
			} else if name == "requirements.txt" {
				p.PackageFile = "requirements.txt"
			}
		case name == "Makefile":
			p.BuildFiles = append(p.BuildFiles, "Makefile")
		case name == "Dockerfile":
			p.BuildFiles = append(p.BuildFiles, "Dockerfile")
		case strings.HasSuffix(name, ".toml") || strings.HasSuffix(name, ".yaml") || strings.HasSuffix(name, ".yml"):
			if !isBuildFile(name) {
				p.ConfigFiles = append(p.ConfigFiles, name)
			}
		case name == ".github":
			p.BuildFiles = append(p.BuildFiles, ".github/workflows/")
		case name == ".git":
			p.IsGitRepo = true
		}
	}

	// Also check if .git exists (it might not appear in ReadDir on all platforms).
	if !p.IsGitRepo {
		if info, err := os.Stat(filepath.Join(root, ".git")); err == nil && info.IsDir() {
			p.IsGitRepo = true
		}
	}

	// Scan directory tree up to max depth.
	p.DirectoryTree = scanDir(root, "", opts.MaxDepth, opts.ExcludeDirs)

	// Count files.
	p.FileCount, p.LineCount = countCode(root, opts)

	return p, nil
}

// Summary returns a human-readable project summary suitable for system prompts.
func (p *Project) Summary() string {
	var b strings.Builder
	b.WriteString("## Project Information\n")
	b.WriteString(fmt.Sprintf("- Languages: %s\n", strings.Join(p.Languages, ", ")))
	if len(p.Frameworks) > 0 {
		b.WriteString(fmt.Sprintf("- Frameworks: %s\n", strings.Join(p.Frameworks, ", ")))
	}
	if len(p.BuildTools) > 0 {
		b.WriteString(fmt.Sprintf("- Build: %s\n", strings.Join(p.BuildTools, ", ")))
	}
	if len(p.TestTools) > 0 {
		b.WriteString(fmt.Sprintf("- Test: %s\n", strings.Join(p.TestTools, ", ")))
	}
	b.WriteString(fmt.Sprintf("- Files: %d (%d lines)\n", p.FileCount, p.LineCount))
	if p.PackageFile != "" {
		b.WriteString(fmt.Sprintf("- Package: %s\n", p.PackageFile))
	}
	if p.IsGitRepo {
		b.WriteString("- Git: yes\n")
	}
	b.WriteString("\n## Directory Structure\n```\n")
	b.WriteString(p.DirectoryTree.String(0))
	b.WriteString("```\n")
	return b.String()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func appendUnique(slice []string, s string) []string {
	for _, existing := range slice {
		if existing == s {
			return slice
		}
	}
	return append(slice, s)
}

func isBuildFile(name string) bool {
	buildFiles := []string{"llmgate.toml", ".golangci.yml", "tsconfig.json", "vite.config.ts"}
	for _, bf := range buildFiles {
		if name == bf {
			return true
		}
	}
	return false
}

func scanDir(root, prefix string, maxDepth int, exclude []string) *DirNode {
	if maxDepth <= 0 {
		return &DirNode{Name: "...", IsDir: true}
	}

	fullPath := filepath.Join(root, prefix)
	if prefix == "" {
		fullPath = root
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return &DirNode{Name: filepath.Base(fullPath), IsDir: true}
	}

	node := &DirNode{
		Name:  filepath.Base(fullPath),
		IsDir: true,
	}

	if prefix == "" {
		node.Name = filepath.Base(root)
	}

	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			if containsStr(exclude, name) {
				continue
			}
			childPrefix := filepath.Join(prefix, name)
			child := scanDir(root, childPrefix, maxDepth-1, exclude)
			node.Children = append(node.Children, child)
		} else {
			node.Children = append(node.Children, &DirNode{
				Name:  name,
				IsDir: false,
			})
		}
	}

	return node
}

func (n *DirNode) String(indent int) string {
	var b strings.Builder
	prefix := strings.Repeat("  ", indent)
	if n.IsDir {
		if indent > 0 {
			b.WriteString(fmt.Sprintf("%s%s/\n", prefix, n.Name))
		} else {
			b.WriteString(fmt.Sprintf("%s/\n", n.Name))
		}
	} else {
		b.WriteString(fmt.Sprintf("%s%s\n", prefix, n.Name))
	}
	for _, child := range n.Children {
		b.WriteString(child.String(indent + 1))
	}
	return b.String()
}

func countCode(root string, opts AnalysisOptions) (files, lines int) {
	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			base := filepath.Base(path)
			for _, ex := range opts.ExcludeDirs {
				if base == ex {
					return filepath.SkipDir
				}
			}
			return nil
		}
		files++
		if files > opts.MaxFiles {
			return filepath.SkipAll
		}
		// Quick line count (approximate).
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		lines += strings.Count(string(data), "\n")
		return nil
	})
	return
}

func containsStr(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}
