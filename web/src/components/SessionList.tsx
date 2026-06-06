import { type SessionItem, deleteSession } from '../api/client'

interface Props {
  sessions: SessionItem[]
  activeId: string
  onSelect: (id: string) => void
  onRefresh: () => void
}

export default function SessionList({ sessions, activeId, onSelect, onRefresh }: Props) {
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteSession(id)
    onRefresh()
    if (activeId === id) onSelect('')
  }

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {sessions.map((sess) => (
        <div
          key={sess.id}
          onClick={() => onSelect(sess.id)}
          className={`group flex items-center mx-2 px-2 py-1.5 cursor-pointer rounded-lg text-[13px] transition-colors ${
            activeId === sess.id
              ? 'bg-white shadow-sm text-[#1a1a2e]'
              : 'text-[#6b7280] hover:bg-white/70 hover:text-[#374151]'
          }`}
        >
          <svg className="w-3.5 h-3.5 mr-2 shrink-0 text-[#9ca3af]" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.5 3.5a.5.5 0 010-1h11a.5.5 0 010 1h-11zm0 3a.5.5 0 010-1h11a.5.5 0 010 1h-11zm0 3a.5.5 0 010-1h6a.5.5 0 010 1h-6z"/>
          </svg>
          <div className="flex-1 truncate">{sess.title || 'Untitled'}</div>
          <button
            onClick={(e) => handleDelete(e, sess.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#fee2e2] text-[#9ca3af] hover:text-[#ef4444] transition-all ml-1"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
