// Package agent provides AI Agent abstractions built on top of the Graphflow core engine.
//
// This file provides backward-compatible type aliases for types that have been
// extracted to the tool/ and tool/builtin/ packages. New code should import
// those packages directly.
package agent

import (
	"github.com/wzhongyou/cangjie/tool"
	"github.com/wzhongyou/cangjie/tool/builtin"
)

// Tool is an alias for tool.Tool. Provided for backward compatibility.
// New code should use tool.Tool directly.
type Tool = tool.Tool

// SafeTool is an alias for tool.SafeTool.
type SafeTool = tool.SafeTool

// ToolDef is an alias for tool.ToolDef.
type ToolDef = tool.ToolDef

// ToolRegistry is an alias for tool.ToolRegistry.
type ToolRegistry = tool.ToolRegistry

// Permission is an alias for tool.Permission.
type Permission = tool.Permission

// NewToolRegistry is an alias for tool.NewToolRegistry.
var NewToolRegistry = tool.NewToolRegistry

// ToolDefs is an alias for tool.ToolDefs.
var ToolDefs = tool.ToolDefs

// CalculatorTool is an alias for builtin.CalculatorTool.
type CalculatorTool = builtin.CalculatorTool

// Re-export Permission constants for backward compatibility.
const (
	PermFileRead        = tool.PermFileRead
	PermFileWrite       = tool.PermFileWrite
	PermShellExec       = tool.PermShellExec
	PermNetworkOutbound = tool.PermNetworkOutbound
	PermGitRead         = tool.PermGitRead
	PermGitWrite        = tool.PermGitWrite
)
