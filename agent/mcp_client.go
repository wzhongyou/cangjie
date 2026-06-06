// Package agent provides AI Agent abstractions built on top of the Graphflow core engine.
//
// This file provides backward-compatible type aliases for MCP types that have been
// extracted to the tool/mcp/ package. New code should import tool/mcp directly.
package agent

import "github.com/wzhongyou/cangjie/tool/mcp"

// MCPClientAdapter is an alias for mcp.ClientAdapter.
// Provided for backward compatibility.
type MCPClientAdapter = mcp.ClientAdapter

// NewMCPClientAdapter is an alias for mcp.NewClientAdapter.
var NewMCPClientAdapter = mcp.NewClientAdapter
