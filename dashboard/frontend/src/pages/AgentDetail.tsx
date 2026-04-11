import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, PanelLeft, X } from 'lucide-react'
import { api } from '../lib/api'
import Markdown from '../components/Markdown'
import AgentTerminal from '../components/AgentTerminal'
import { getAgentMeta } from '../lib/agent-meta'
import { AgentAvatar } from '../components/AgentAvatar'

interface MemoryFile {
  name: string
  path: string
  size: number
}

type Tab = 'profile' | 'memory'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`
  return `${(bytes / 1024 / 1024).toFixed(1)}mb`
}

function formatName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export default function AgentDetail() {
  const { name } = useParams()
  const [content, setContent] = useState<string | null>(null)
  const [memories, setMemories] = useState<MemoryFile[]>([])
  const [memoryContents, setMemoryContents] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('profile')
  const [railOpen, setRailOpen] = useState(false) // mobile drawer

  useEffect(() => {
    if (!name) return
    setLoading(true)
    Promise.all([
      api.getRaw(`/agents/${name}`).catch(() => null),
      api.get(`/agents/${name}/memory`).catch(() => []),
    ])
      .then(([md, mems]) => {
        setContent(md)
        setMemories(Array.isArray(mems) ? mems : [])
      })
      .finally(() => setLoading(false))
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
        setMemoryContents((prev) => ({ ...prev, [memName]: text }))
      } catch {
        setMemoryContents((prev) => ({ ...prev, [memName]: 'Failed to load' }))
      }
    }
  }

  if (!name) return null

  const meta = getAgentMeta(name)
  const agentColor = meta.color

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#0C111D]">
        <div className="text-[#667085] text-xs uppercase tracking-[0.12em]">loading agent…</div>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#0C111D] gap-3">
        <p className="text-[#667085] text-sm">Agent not found</p>
        <Link to="/agents" className="text-[11px] uppercase tracking-[0.12em] text-[#00FFA7] hover:underline">
          ← Agents
        </Link>
      </div>
    )
  }

  const profileBody = extractProfileBody(content)
  const profileLead = extractProfileLead(content)

  return (
    <div className="flex h-full w-full flex-col bg-[#0C111D]">
      {/* ── HERO STRIP ─────────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-20 flex items-center px-4 lg:px-6 gap-4 border-b border-[#21262d] bg-[#0d1117]">
        <Link
          to="/agents"
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#667085] hover:text-[#e6edf3] transition-colors"
        >
          <ArrowLeft size={12} />
          Agents
        </Link>

        <span className="text-[#21262d]">·</span>

        {/* Avatar */}
        <div
          className="rounded-full flex-shrink-0"
          style={{ padding: 2, background: `${agentColor}40` }}
        >
          <AgentAvatar name={name} size={60} />
        </div>

        <div className="flex flex-col gap-0.5 min-w-0">
          <h1 className="text-[16px] font-semibold text-[#e6edf3] tracking-tight truncate">
            {formatName(name)}
          </h1>
          <code
            className="font-mono text-[11px] tracking-tight"
            style={{ color: agentColor }}
          >
            {meta.command}
          </code>
        </div>

        {/* Memory count — right aligned */}
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.12em] text-[#667085]">
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </span>

          {/* Mobile drawer toggle */}
          <button
            onClick={() => setRailOpen(true)}
            className="lg:hidden flex h-8 w-8 items-center justify-center rounded-md border border-[#21262d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#30363d]"
            aria-label="Open agent info"
          >
            <PanelLeft size={14} />
          </button>
        </div>
      </header>

      {/* ── BODY ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Info rail — desktop */}
        <aside className="hidden lg:flex flex-col w-[320px] flex-shrink-0 border-r border-[#21262d] bg-[#0d1117]">
          <InfoRail
            tab={tab}
            setTab={setTab}
            agentColor={agentColor}
            profileLead={profileLead}
            profileBody={profileBody}
            memories={memories}
            expandedMemory={expandedMemory}
            memoryContents={memoryContents}
            toggleMemory={toggleMemory}
            agentSlug={name}
          />
        </aside>

        {/* Info rail — mobile drawer */}
        {railOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setRailOpen(false)}
          >
            <aside
              className="absolute top-14 left-0 bottom-0 w-[85vw] max-w-[340px] border-r border-[#21262d] bg-[#0d1117] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 h-10 border-b border-[#21262d]">
                <span className="text-[10px] uppercase tracking-[0.12em] text-[#667085]">
                  {formatName(name)}
                </span>
                <button
                  onClick={() => setRailOpen(false)}
                  className="text-[#8b949e] hover:text-[#e6edf3]"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <InfoRail
                tab={tab}
                setTab={setTab}
                agentColor={agentColor}
                profileLead={profileLead}
                profileBody={profileBody}
                memories={memories}
                expandedMemory={expandedMemory}
                memoryContents={memoryContents}
                toggleMemory={toggleMemory}
                agentSlug={name}
              />
            </aside>
          </div>
        )}

        {/* Terminal stage */}
        <section className="flex-1 min-w-0 relative bg-[#0C111D] overflow-hidden">
          {/* Ambient glow */}
          <div
            className="pointer-events-none absolute top-0 right-0 h-[400px] w-[400px] blur-3xl"
            style={{
              background: `radial-gradient(circle, ${agentColor} 0%, transparent 60%)`,
              opacity: 0.06,
            }}
          />
          <div className="relative z-10 h-full">
            <AgentTerminal agent={name} accentColor={agentColor} />
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── InfoRail ─────────────────────────────────────────────────────────

interface InfoRailProps {
  tab: Tab
  setTab: (t: Tab) => void
  agentColor: string
  profileLead: string | null
  profileBody: string
  memories: MemoryFile[]
  expandedMemory: string | null
  memoryContents: Record<string, string>
  toggleMemory: (name: string) => void
  agentSlug: string
}

function InfoRail({
  tab,
  setTab,
  agentColor,
  profileLead,
  profileBody,
  memories,
  expandedMemory,
  memoryContents,
  toggleMemory,
  agentSlug,
}: InfoRailProps) {
  return (
    <>
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center h-10 px-5 gap-6 border-b border-[#21262d]">
        <TabButton label="Profile" active={tab === 'profile'} onClick={() => setTab('profile')} color={agentColor} />
        <TabButton
          label="Memory"
          active={tab === 'memory'}
          onClick={() => setTab('memory')}
          color={agentColor}
          count={memories.length}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {tab === 'profile' && (
          <div>
            {profileLead && (
              <p className="text-[13px] leading-[1.6] text-[#e6edf3] mb-4 pb-4 border-b border-[#21262d]">
                {profileLead}
              </p>
            )}
            <div
              className="prose-agent text-[12.5px] leading-[1.65] text-[#8b949e]"
              style={
                {
                  ['--agent-color' as string]: agentColor,
                } as React.CSSProperties
              }
            >
              <Markdown>{profileBody}</Markdown>
            </div>
          </div>
        )}

        {tab === 'memory' &&
          (memories.length === 0 ? (
            <div className="text-[12px] text-[#667085]">
              <p className="mb-1">Sem memórias ainda.</p>
              <p className="text-[11px] text-[#3F3F46]">
                Adicione arquivos em{' '}
                <code className="font-mono text-[#667085]">.claude/agent-memory/{agentSlug}/</code>
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {memories.map((mem) => {
                const open = expandedMemory === mem.name
                return (
                  <li key={mem.name}>
                    <button
                      onClick={() => toggleMemory(mem.name)}
                      className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-[#161b22] text-left transition-colors"
                    >
                      {open ? (
                        <ChevronDown size={11} className="text-[#667085] flex-shrink-0" />
                      ) : (
                        <ChevronRight size={11} className="text-[#3F3F46] flex-shrink-0" />
                      )}
                      <span className="font-mono text-[11.5px] text-[#e6edf3] truncate">
                        {mem.name}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-[#667085] flex-shrink-0">
                        {formatSize(mem.size)}
                      </span>
                    </button>
                    {open && (
                      <div
                        className="ml-4 mt-1 mb-2 pl-4 py-1 border-l text-[11.5px] leading-[1.6] text-[#8b949e] overflow-hidden"
                        style={{ borderColor: `${agentColor}40` }}
                      >
                        <Markdown>{memoryContents[mem.name] || 'Loading...'}</Markdown>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </div>
    </>
  )
}

function TabButton({
  label,
  active,
  onClick,
  color,
  count,
}: {
  label: string
  active: boolean
  onClick: () => void
  color: string
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className="relative h-10 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] font-medium transition-colors"
      style={{ color: active ? '#e6edf3' : '#667085' }}
    >
      {label}
      {count !== undefined && (
        <span className="font-mono text-[10px] text-[#3F3F46]">{count}</span>
      )}
      {active && (
        <span
          className="absolute bottom-0 left-0 right-0 h-[2px]"
          style={{ backgroundColor: color }}
        />
      )}
    </button>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

// Pull the first substantive paragraph (after any YAML frontmatter & H1)
// to act as the "lead" intro above the main markdown body.
function extractProfileLead(md: string): string | null {
  const stripped = md.replace(/^---[\s\S]*?---\s*/m, '')
  const lines = stripped.split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('#')) continue
    if (t.startsWith('```')) return null
    // Skip markdown list/quote markers
    if (/^[-*>]\s/.test(t)) continue
    return t.length > 300 ? t.slice(0, 297) + '…' : t
  }
  return null
}

function extractProfileBody(md: string): string {
  return md.replace(/^---[\s\S]*?---\s*/m, '')
}
