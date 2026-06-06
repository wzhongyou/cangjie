import { useState, useEffect } from 'react'
import ChatPanel from './components/ChatPanel'
import SessionList from './components/SessionList'
import { fetchSessions, createSession, type SessionItem } from './api/client'

export default function App() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [activeSession, setActiveSession] = useState<string>('')
  const [showSidebar, setShowSidebar] = useState(true)

  useEffect(() => {
    fetchSessions().then(setSessions).catch(console.error)
  }, [])

  const handleNewChat = async () => {
    try {
      const id = await createSession('New Chat')
      setActiveSession(id)
      fetchSessions().then(setSessions)
    } catch (err) {
      console.error('Failed:', err)
    }
  }

  return (
    <div className="flex h-screen bg-[#fafbfc]">
      {/* Sidebar */}
      <div
        className={`${
          showSidebar ? 'w-64' : 'w-0'
        } transition-all duration-200 bg-[#f3f4f6] border-r border-[#e5e7eb] flex flex-col overflow-hidden shrink-0`}
      >
        <div className="p-3 border-b border-[#e5e7eb]">
          <button
            onClick={handleNewChat}
            className="w-full py-2 px-3 text-sm rounded-lg bg-white border border-[#e5e7eb] hover:border-[#4f6ef7] hover:text-[#4f6ef7] text-[#374151] transition-all shadow-sm"
          >
            + New Chat
          </button>
        </div>
        <SessionList
          sessions={sessions}
          activeId={activeSession}
          onSelect={setActiveSession}
          onRefresh={() => fetchSessions().then(setSessions)}
        />
        <div className="p-3 border-t border-[#e5e7eb] text-[10px] text-[#9ca3af] text-center">
          Cangjie AGUI v0.3
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-10 flex items-center px-3 border-b border-[#e5e7eb] bg-white shrink-0">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="mr-3 p-1 rounded-md hover:bg-[#f3f4f6] text-[#6b7280] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.75A.75.75 0 011.75 2h12.5a.75.75 0 010 1.5H1.75A.75.75 0 011 2.75zm0 5A.75.75 0 011.75 7h12.5a.75.75 0 010 1.5H1.75A.75.75 0 011 7.75zM1.75 12a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H1.75z"/>
            </svg>
          </button>
          <span className="text-xs text-[#6b7280] font-medium tracking-wide">Cangjie AGUI</span>
        </header>
        <ChatPanel sessionId={activeSession} onSessionChange={setActiveSession} />
      </div>
    </div>
  )
}
