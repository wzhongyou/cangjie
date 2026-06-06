import { useState, useRef, useCallback } from 'react'
import { streamChat, type StreamEvent, type Message } from '../api/client'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  isStreaming?: boolean
  toolCalls?: string[]
}

let msgCounter = 0
function nextId() {
  return `msg-${++msgCounter}-${Date.now()}`
}

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const loadMessages = useCallback(async () => {
    if (!sessionId) return
    const { fetchMessages } = await import('../api/client')
    const msgs = await fetchMessages(sessionId)
    setMessages(msgs.map((m: Message) => ({
      id: nextId(),
      role: m.role as ChatMessage['role'],
      content: m.content,
    })))
  }, [sessionId])

  const send = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content }
    setMessages(prev => [...prev, userMsg])
    setIsStreaming(true)

    const assistantMsg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      isStreaming: true,
      toolCalls: [],
    }

    setMessages(prev => [...prev, assistantMsg])

    const controller = streamChat(
      content,
      sessionId,
      (ev: StreamEvent) => {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (!last || last.role !== 'assistant') return prev

          switch (ev.type) {
            case 'thought':
              last.toolCalls = [...(last.toolCalls || []), `思考: ${ev.content || ''}`]
              break
            case 'tool_call':
              last.toolCalls = [...(last.toolCalls || []), `调用: ${ev.tool_name || ''}`]
              break
            case 'tool_result':
              last.toolCalls = [...(last.toolCalls || []), `结果: ${(ev.content || '').slice(0, 80)}`]
              break
            case 'answer':
              last.content += ev.content || ''
              break
            case 'done':
              last.isStreaming = false
              break
          }
          return updated
        })
      },
      () => {
        setIsStreaming(false)
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last) last.isStreaming = false
          return updated
        })
      },
      (err) => {
        setIsStreaming(false)
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last) {
            last.content += `\n\n*错误: ${err.message}*`
            last.isStreaming = false
          }
          return updated
        })
      },
    )

    abortRef.current = controller
  }, [sessionId, isStreaming])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  return { messages, isStreaming, send, abort, loadMessages, setMessages }
}
