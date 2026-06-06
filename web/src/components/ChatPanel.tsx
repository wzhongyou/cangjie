import { useEffect, useRef, useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useChat, type ChatMessage } from '../hooks/useChat'

interface Props {
  sessionId: string
  onSessionChange: (id: string) => void
}

export default function ChatPanel({ sessionId, onSessionChange }: Props) {
  const { messages, isStreaming, send, abort, loadMessages, setMessages } = useChat(sessionId)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sessionId) { setMessages([]); loadMessages() }
  }, [sessionId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    send(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-4xl mb-3 text-[#d1d5db] font-light">Cangjie</div>
              <p className="text-[#9ca3af] text-sm">
                {sessionId ? 'Type a message to start' : 'Click + New Chat to start'}
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-[820px] mx-auto px-6 py-6 space-y-1">
            {messages.map((msg) => (
              <Bubble key={msg.id} message={msg} />
            ))}
          </div>
        )}

        {isStreaming && (
          <div className="flex justify-center pb-3">
            <button onClick={abort}
              className="px-3 py-1 text-xs rounded-md border border-[#e5e7eb] bg-white text-[#6b7280] hover:text-[#ef4444] transition-colors">
              Stop generating
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="max-w-[820px] mx-auto w-full px-6 pb-6">
        <div className="flex gap-2 bg-white border border-[#e5e7eb] rounded-xl focus-within:border-[#4f6ef7] focus-within:ring-2 focus-within:ring-[#eef1ff] transition-all px-4 py-2.5 shadow-sm">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sessionId ? 'Message Cangjie...' : 'Create a session first'}
            disabled={!sessionId}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none text-[14px] text-[#1a1a2e] placeholder-[#9ca3af] resize-none py-0.5 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim() || !sessionId}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-[#4f6ef7] hover:bg-[#3b5de7] disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5 -mr-px" viewBox="0 0 16 16" fill="currentColor"><path d="M15.854.146a.5.5 0 01.11.54l-5.819 14.547a.75.75 0 01-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 01.124-1.33L15.314.037a.5.5 0 01.54.11z"/></svg>
          </button>
        </div>
        <p className="text-[10px] text-[#9ca3af] text-center mt-2">
          Cangjie may produce inaccurate information. Verify important responses.
        </p>
      </div>
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[88%]`}>
        {isUser ? (
          <div className="bg-[#eef1ff] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] text-[#1a1a2e] leading-relaxed">
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
        ) : isTool ? (
          <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg px-3 py-2 text-[12px] text-[#6b7280] font-mono break-all">
            {message.content}
          </div>
        ) : (
          <div className="text-[14px] text-[#374151] leading-relaxed">
            <div className="markdown-body">
              <MemoMarkdown content={message.content} />
              {message.isStreaming && <span className="stream-cursor" />}
            </div>

            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[#e5e7eb] space-y-0.5">
                {message.toolCalls.map((tc, i) => (
                  <div key={i} className="text-[11px] text-[#6b7280] font-mono flex items-center gap-1">
                    <span className="text-[#9ca3af]">→</span> {tc}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const MemoMarkdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const codeStr = String(children).replace(/\n$/, '')
          return !inline(match) ? (
            <div className="my-2 rounded-lg border border-[#e5e7eb] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#f9fafb] border-b border-[#e5e7eb]">
                <span className="text-[11px] text-[#6b7280] font-mono font-medium">{match![1]}</span>
                <CopyButton text={codeStr} />
              </div>
              <SyntaxHighlighter
                style={oneLight as any}
                language={match![1]}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: 0, background: '#fafbfc', fontSize: '0.8rem' } as any}
                {...props}
              >
                {codeStr}
              </SyntaxHighlighter>
            </div>
          ) : (
            <code className="text-[#4f6ef7] bg-[#eef1ff] px-1 py-0.5 rounded text-[0.85rem] font-medium" {...props}>{children}</code>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
})

function inline(match: RegExpExecArray | null) { return !match }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] text-[#9ca3af] hover:text-[#6b7280] transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}
