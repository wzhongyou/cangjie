// Package builtin provides standard built-in tools for the Cangjie agent platform.
//
// These tools cover common operations like file I/O, shell execution, git commands,
// web search, and arithmetic evaluation.
package builtin

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"

	"github.com/wzhongyou/cangjie/tool"
)

// CalculatorTool evaluates arithmetic expressions.
type CalculatorTool struct{}

// Ensure CalculatorTool implements tool.Tool.
var _ tool.Tool = (*CalculatorTool)(nil)

func (c *CalculatorTool) Name() string        { return "calculator" }
func (c *CalculatorTool) Description() string { return "Evaluate a mathematical expression. Supports +, -, *, /, and parentheses." }
func (c *CalculatorTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"expression": map[string]any{
				"type":        "string",
				"description": "Mathematical expression to evaluate, e.g. '(3 + 4) * 5'",
			},
		},
		"required": []string{"expression"},
	}
}

func (c *CalculatorTool) Execute(_ context.Context, args map[string]any) (string, error) {
	expr, ok := args["expression"]
	if !ok {
		return "", fmt.Errorf("calculator: missing 'expression' argument")
	}
	exprStr, ok := expr.(string)
	if !ok {
		return "", fmt.Errorf("calculator: 'expression' must be a string")
	}
	result, err := evalExpr(exprStr)
	if err != nil {
		return "", fmt.Errorf("calculator: %w", err)
	}
	return strconv.FormatFloat(result, 'f', -1, 64), nil
}

// evalExpr parses and evaluates a simple arithmetic expression.
func evalExpr(expr string) (float64, error) {
	tree, err := parser.ParseExpr(expr)
	if err != nil {
		return 0, fmt.Errorf("parse %q: %w", expr, err)
	}
	return evalNode(tree)
}

func evalNode(n ast.Expr) (float64, error) {
	switch e := n.(type) {
	case *ast.BasicLit:
		if e.Kind == token.INT || e.Kind == token.FLOAT {
			return strconv.ParseFloat(e.Value, 64)
		}
		return 0, fmt.Errorf("unsupported literal: %s", e.Value)
	case *ast.BinaryExpr:
		left, err := evalNode(e.X)
		if err != nil {
			return 0, err
		}
		right, err := evalNode(e.Y)
		if err != nil {
			return 0, err
		}
		switch e.Op {
		case token.ADD:
			return left + right, nil
		case token.SUB:
			return left - right, nil
		case token.MUL:
			return left * right, nil
		case token.QUO:
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			return left / right, nil
		default:
			return 0, fmt.Errorf("unsupported operator: %s", e.Op)
		}
	case *ast.ParenExpr:
		return evalNode(e.X)
	case *ast.UnaryExpr:
		val, err := evalNode(e.X)
		if err != nil {
			return 0, err
		}
		if e.Op == token.SUB {
			return -val, nil
		}
		return val, nil
	default:
		return 0, fmt.Errorf("unsupported expression type: %T", n)
	}
}
