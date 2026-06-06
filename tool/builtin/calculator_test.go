package builtin

import (
	"context"
	"testing"
)

func TestCalculator_Simple(t *testing.T) {
	c := &CalculatorTool{}
	result, err := c.Execute(context.Background(), map[string]any{"expression": "2 + 3"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "5" {
		t.Fatalf("expected '5', got %q", result)
	}
}

func TestCalculator_Complex(t *testing.T) {
	c := &CalculatorTool{}
	result, err := c.Execute(context.Background(), map[string]any{"expression": "(3 + 4) * 5"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "35" {
		t.Fatalf("expected '35', got %q", result)
	}
}

func TestCalculator_DivisionByZero(t *testing.T) {
	c := &CalculatorTool{}
	_, err := c.Execute(context.Background(), map[string]any{"expression": "1 / 0"})
	if err == nil {
		t.Fatal("expected error for division by zero")
	}
}

func TestCalculator_MissingArg(t *testing.T) {
	c := &CalculatorTool{}
	_, err := c.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing argument")
	}
}

func TestCalculator_ImplementsTool(t *testing.T) {
	c := &CalculatorTool{}
	if c.Name() != "calculator" {
		t.Fatalf("expected name 'calculator', got %q", c.Name())
	}
	if c.Description() == "" {
		t.Fatal("expected non-empty description")
	}
	if c.Parameters() == nil {
		t.Fatal("expected non-nil parameters")
	}
}
