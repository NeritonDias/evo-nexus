import { useRef } from 'react'
import { X } from 'lucide-react'

export interface TabEntry {
  path: string
}

interface FileTabsProps {
  tabs: TabEntry[]
  activePath: string | null
  dirtyPaths: Set<string>
  onSwitch: (path: string) => void
  onClose: (path: string) => void
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export default function FileTabs({ tabs, activePath, dirtyPaths, onSwitch, onClose }: FileTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  if (tabs.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="flex items-end overflow-x-auto flex-shrink-0"
      style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        minHeight: '36px',
      }}
    >
      <style>{`
        .file-tabs-scroll::-webkit-scrollbar { display: none; }
        .file-tab-close { opacity: 0; }
        .file-tab:hover .file-tab-close,
        .file-tab.active .file-tab-close { opacity: 1; }
      `}</style>
      {tabs.map(tab => {
        const isActive = tab.path === activePath
        const isDirty = dirtyPaths.has(tab.path)

        return (
          <button
            key={tab.path}
            className={`file-tab flex items-center gap-1.5 px-3 py-2 text-xs flex-shrink-0 transition-colors relative select-none${isActive ? ' active' : ''}`}
            style={{
              maxWidth: '200px',
              minWidth: '80px',
              borderBottom: isActive ? '2px solid var(--evo-green)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              background: isActive ? 'var(--surface-active)' : 'transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            onClick={() => onSwitch(tab.path)}
            onMouseDown={e => {
              if (e.button === 1) {
                e.preventDefault()
                onClose(tab.path)
              }
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.background = 'var(--surface-hover)'
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.background = 'transparent'
            }}
            title={tab.path}
          >
            {/* Dirty indicator dot */}
            {isDirty && (
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--warning)',
                  flexShrink: 0,
                  display: 'inline-block',
                }}
              />
            )}

            {/* File name */}
            <span
              className="truncate flex-1 min-w-0"
              style={{ maxWidth: isDirty ? '130px' : '150px' }}
            >
              {fileName(tab.path)}
            </span>

            {/* Close button */}
            <span
              className="file-tab-close flex items-center justify-center flex-shrink-0 rounded transition-colors"
              style={{
                width: '16px',
                height: '16px',
              }}
              onClick={e => {
                e.stopPropagation()
                onClose(tab.path)
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--border)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <X size={10} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
