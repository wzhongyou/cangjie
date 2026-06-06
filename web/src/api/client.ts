export interface StreamEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'answer' | 'done'
  content?: string
  tool_name?: string
  tokens?: number
}

export interface SessionItem {
  id: string
  title: string
  created_at: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

const BASE = '/api'

export async function fetchSessions(): Promise<SessionItem[]> {
  const res = await fetch(`${BASE}/sessions`)
  const data = await res.json()
  return data.sessions || []
}

export async function createSession(title: string): Promise<string> {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const data = await res.json()
  return data.id
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  const res = await fetch(`${BASE}/sessions/${sessionId}`)
  const data = await res.json()
  return data.messages || []
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/sessions/${sessionId}`, { method: 'DELETE' })
}

export function streamChat(
  message: string,
  sessionId: string,
  onEvent: (ev: StreamEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController()

  fetch(`${BASE}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev: StreamEvent = JSON.parse(line.slice(6))
              onEvent(ev)
            } catch {
              // Skip malformed events.
            }
          }
        }
      }
      onDone()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err)
      }
    })

  return controller
}
