// Package memory provides short-term and long-term memory implementations
// for the Cangjie agent platform.
package memory

import "github.com/wzhongyou/cangjie/agent"

// ShortTermMemory keeps the recent conversation window in memory.
type ShortTermMemory struct {
	maxMessages int
	messages    []agent.Message
}

// NewShortTermMemory creates a memory buffer capped at maxMessages.
func NewShortTermMemory(maxMessages int) *ShortTermMemory {
	return &ShortTermMemory{maxMessages: maxMessages}
}

// Add appends a message, evicting the oldest if the buffer exceeds maxMessages.
func (m *ShortTermMemory) Add(msg agent.Message) {
	m.messages = append(m.messages, msg)
	if len(m.messages) > m.maxMessages {
		// Evict oldest non-system messages first to preserve system prompts.
		idx := 0
		for idx < len(m.messages) && len(m.messages) > m.maxMessages {
			if m.messages[idx].Role != agent.RoleSystem {
				m.messages = append(m.messages[:idx], m.messages[idx+1:]...)
			} else {
				idx++
			}
		}
		// If still over limit after preserving system messages, trim from front.
		if len(m.messages) > m.maxMessages {
			excess := len(m.messages) - m.maxMessages
			m.messages = m.messages[excess:]
		}
	}
}

// Messages returns the current message window.
func (m *ShortTermMemory) Messages() []agent.Message { return m.messages }
