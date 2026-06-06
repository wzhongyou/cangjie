package agent

import (
	"encoding/json"
	"fmt"
)

// StructuredOutputConfig configures structured output (JSON Schema-constrained LLM output).
type StructuredOutputConfig struct {
	// Schema is a JSON Schema document describing the expected output structure.
	Schema map[string]any
	// Instruction is an override for the additional system prompt instruction.
	// Default: "You must return valid JSON conforming to the following JSON Schema: {schema}"
	Instruction string
	// SchemaName is a human-readable name for the schema, used in the default instruction.
	SchemaName string
}

// BuildInstruction generates the structured output instruction appended to the system prompt.
func (c *StructuredOutputConfig) BuildInstruction() string {
	if c.Instruction != "" {
		return c.Instruction
	}
	schemaJSON, err := json.Marshal(c.Schema)
	if err != nil {
		return "You must return valid JSON."
	}
	name := c.SchemaName
	if name == "" {
		name = "Output"
	}
	return fmt.Sprintf("You must return valid JSON conforming to the following JSON Schema (%s):\n```json\n%s\n```\nDo not include any additional text or Markdown formatting.",
		name, string(schemaJSON))
}

// ValidateStructuredOutput validates that content conforms to the given JSON Schema.
// Returns the parsed JSON object, or an error if validation fails.
func ValidateStructuredOutput(content string, schema map[string]any) (map[string]any, error) {
	var result map[string]any
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("structured output parse failed (not valid JSON): %w", err)
	}

	// Check required fields are present.
	if requiredRaw, ok := schema["required"]; ok {
		switch required := requiredRaw.(type) {
		case []any:
			for _, field := range required {
				fieldName, ok := field.(string)
				if !ok {
					continue
				}
				if _, exists := result[fieldName]; !exists {
					return nil, fmt.Errorf("structured output validation failed: missing required field %q", fieldName)
				}
			}
		case []string:
			for _, fieldName := range required {
				if _, exists := result[fieldName]; !exists {
					return nil, fmt.Errorf("structured output validation failed: missing required field %q", fieldName)
				}
			}
		}
	}

	return result, nil
}
