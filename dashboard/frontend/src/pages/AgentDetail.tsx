import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Terminal as TerminalIcon, FileText, Brain } from 'lucide-react'
import { api } from '../lib/api'
import Markdown from '../components/Markdown'
import AgentTerminal from '../components/AgentTerminal'

interface MemoryFile {
  name: string
  path: string
  size: number
}

type Tab = 'profile' | 'memory'

export default function AgentDetail() {
  const { name } = useParams()
  const [content, setContent] = useState<string | null>(null)
  const [memories, setMemories] = useState<MemoryFile[]>([])
  const [memoryContents, setMemoryContents] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('profile')

  useEffect(() => {
    if (name) {
      setLoading(true)
      Promise.all([
        api.getRaw(`/agents/${name}`).catch(() => null),
        api.get(`/agents/${name}/memory`).catch(() => []),
      ]).then(([md, mems]) => {
        setContent(md)
        setMemories(Array.isArray(mems) ? mems : [])
      }).finally(() => setLoading(false))
    }
  }, [name])

  const toggleMemory = async (memName: string) => {
    if (expandedMemory === memName) {
      setExpandedMemory(null)
      return
    }
    setExpandedMemory(memName)
    if (!memoryContents[memName]) {
      try {
        const text = await api.getRaw(`/agents/${name}/memory/${memName}`)
        setMemoryContents(prev => ({ ...prev, [memName]: text }))
      } catch {
        setMemoryContents(prev => ({ ...prev, [memName]: 'Failed to load' }))
      }
    }
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton h-8 w-48 mb-4 rounded" />
        <div className="skeleton h-96 rounded-xl" />
      </div>
    )
  }

  if (!content) {
    return (
      <div className="text-center py-12">
        <p className="text-[#667085]">Agent not found</p>
        <Link to="/agents" className="text-[#00FFA7] text-sm hover:underline mt-2 inline-block">
          Back to agents
        </Link>
      </div>
    )
  }

  const slashCommand = `/${name}`

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <Link to="/agents" className="text-[#00FFA7] text-xs hover:underline mb-2 inline-block">
          &larr; Back to agents
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[#F9FAFB]">{name}</h1>
          <code className="rounded-md bg-[#0d1117] px-2 py-0.5 font-mono text-xs text-[#8b949e] border border-[#21262d]">
            {slashCommand}
          </code>
        </div>
      </div>

      {/* Split: info (left) + terminal (right) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        {/* LEFT — Info panel with tabs */}
        <div className="flex flex-col min-h-0 bg-[#182230] border border-[#344054] rounded-xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex-shrink-0 flex items-center border-b border-[#344054]">
            <button
              onClick={() => setTab('profile')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium transition-colors ${
                tab === 'profile'
                  ? 'text-[#F9FAFB] border-b-2 border-[#00FFA7]'
                  : 'text-[#667085] hover:text-[#F9FAFB]'
              }`}
            >
              <FileText size={14} />
              Profile
            </button>
            <button
              onClick={() => setTab('memory')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium transition-colors ${
                tab === 'memory'
                  ? 'text-[#F9FAFB] border-b-2 border-[#00FFA7]'
                  : 'text-[#667085] hover:text-[#F9FAFB]'
              }`}
            >
              <Brain size={14} />
              Memory
              {memories.length > 0 && (
                <span className="rounded-full bg-[#344054] px-1.5 py-0.5 text-[10px] text-[#8b949e]">
                  {memories.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-4">
            {tab === 'profile' && (
              <Markdown>{content}</Markdown>
            )}
            {tab === 'memory' && (
              memories.length === 0 ? (
                <p className="text-sm text-[#667085]">No memories yet.</p>
              ) : (
                <div className="space-y-2">
                  {memories.map((mem) => (
                    <div key={mem.name} className="bg-[#0d1117] border border-[#344054] rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleMemory(mem.name)}
                        className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors text-left"
                      >
                        <span className="text-xs text-[#F9FAFB]">{mem.name}</span>
                        {expandedMemory === mem.name ? (
                          <ChevronDown size={14} className="text-[#667085]" />
                        ) : (
                          <ChevronRight size={14} className="text-[#667085]" />
                        )}
                      </button>
                      {expandedMemory === mem.name && (
                        <div className="p-3 pt-0 border-t border-[#344054]">
                          <Markdown>{memoryContents[mem.name] || 'Loading...'}</Markdown>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        {/* RIGHT — Terminal */}
        <div className="flex flex-col min-h-0">
          <div className="flex-shrink-0 flex items-center gap-2 mb-2 text-xs text-[#667085]">
            <TerminalIcon size={12} />
            <span>Terminal · {slashCommand}</span>
          </div>
          <div className="flex-1 min-h-0">
            {name && <AgentTerminal agent={name} />}
          </div>
        </div>
      </div>
    </div>
  )
}
