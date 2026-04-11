import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'
import { api } from '../lib/api'
import FileTree from '../components/workspace/FileTree'
import FileToolbar, { type EditorMode } from '../components/workspace/FileToolbar'
import FilePreview from '../components/workspace/FilePreview'
import FileEditor from '../components/workspace/FileEditor'
import ConfirmDialog, { type ConfirmVariant } from '../components/workspace/ConfirmDialog'
import UploadDropzone from '../components/workspace/UploadDropzone'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

// Toast
interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

let toastCounter = 0

// Inline name input dialog
interface NameDialogProps {
  title: string
  placeholder: string
  defaultValue?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

function NameDialog({ title, placeholder, defaultValue = '', onConfirm, onCancel }: NameDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="w-full max-w-sm mx-4 p-5 rounded-xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{title}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()) }}
          className="w-full text-sm rounded-lg px-3 py-2 outline-none mb-4"
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--evo-green)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            Cancelar
          </button>
          <button
            onClick={() => value.trim() && onConfirm(value.trim())}
            className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
            style={{
              background: 'var(--evo-green)',
              color: '#0C111D',
              opacity: value.trim() ? 1 : 0.5,
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Workspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [isDir, setIsDir] = useState(false)
  const [mode, setMode] = useState<EditorMode>('preview')
  const [isDirty, setIsDirty] = useState(false)
  const [editorContent, setEditorContent] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showUpload, setShowUpload] = useState(false)
  const [showDrag, setShowDrag] = useState(false)

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    variant: ConfirmVariant
    filename: string
    onConfirm: () => void
  } | null>(null)

  // Name dialog
  const [nameDialog, setNameDialog] = useState<NameDialogProps | null>(null)

  // Editor content getter ref
  const editorRef = useRef<{ getContent: () => string } | null>(null)

  // Overwrite promise resolvers
  const overwriteResolverRef = useRef<((v: boolean) => void) | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastCounter
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // Deep-link: sync URL → selectedPath
  // URL shape: /workspace/<path>
  //   /workspace                                    → no selection
  //   /workspace/finance/x.md                       → treated as workspace/finance/x.md
  //   /workspace/.claude/agents/apex.md             → admin scope, kept as-is
  useEffect(() => {
    const raw = location.pathname.replace(/^\/workspace\/?/, '')
    if (!raw) {
      if (selectedPath !== null) setSelectedPath(null)
      return
    }
    let decoded = decodeURIComponent(raw.replace(/\/$/, ''))
    // Normalize: if path doesn't start with a known top-level root,
    // assume it's relative to workspace/
    const ADMIN_PREFIXES = ['workspace/', 'workspace', '.claude/', '.claude', 'config/', 'config', 'docs/', 'docs']
    const hasKnownPrefix = ADMIN_PREFIXES.some(p => decoded === p || decoded.startsWith(p + '/'))
    if (!hasKnownPrefix) {
      decoded = `workspace/${decoded}`
    }
    if (decoded === selectedPath) return
    ;(async () => {
      try {
        // Probe as file first; fall back to dir on 400
        const res = await fetch(`${API_BASE}/api/workspace/file?path=${encodeURIComponent(decoded)}`, {
          credentials: 'include',
        })
        if (res.ok) {
          setSelectedPath(decoded)
          setIsDir(false)
          setMode('preview')
          return
        }
        // Try as tree (directory)
        const treeRes = await fetch(`${API_BASE}/api/workspace/tree?path=${encodeURIComponent(decoded)}&depth=1`, {
          credentials: 'include',
        })
        if (treeRes.ok) {
          setSelectedPath(decoded)
          setIsDir(true)
          setMode('preview')
        }
      } catch {
        // ignore — leave state as-is
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Sync selectedPath → URL (strip leading "workspace/" to keep URLs short)
  useEffect(() => {
    const currentUrlPath = location.pathname.replace(/^\/workspace\/?/, '')
    let decodedCurrent = decodeURIComponent(currentUrlPath.replace(/\/$/, ''))
    // Normalize same way the reverse sync does, for comparison
    const ADMIN_PREFIXES = ['workspace/', 'workspace', '.claude/', '.claude', 'config/', 'config', 'docs/', 'docs']
    const hasKnownPrefix = ADMIN_PREFIXES.some(p => decodedCurrent === p || decodedCurrent.startsWith(p + '/'))
    if (decodedCurrent && !hasKnownPrefix) {
      decodedCurrent = `workspace/${decodedCurrent}`
    }
    const target = selectedPath ?? ''
    if (decodedCurrent === target) return
    // Strip leading "workspace/" from URL for brevity
    const urlPath = target.startsWith('workspace/') ? target.slice('workspace/'.length) : target
    const next = urlPath ? `/workspace/${urlPath.split('/').map(encodeURIComponent).join('/')}` : '/workspace'
    navigate(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath])

  // Global drag detection for dropzone overlay
  useEffect(() => {
    let dragCounter = 0
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounter++
        setShowDrag(true)
      }
    }
    const onDragLeave = () => {
      dragCounter--
      if (dragCounter <= 0) { dragCounter = 0; setShowDrag(false) }
    }
    const onDrop = () => { dragCounter = 0; setShowDrag(false) }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const handleSelect = useCallback((path: string, dir: boolean) => {
    if (isDirty) {
      setConfirmDialog({
        variant: 'discard',
        filename: selectedPath?.split('/').pop() ?? '',
        onConfirm: () => {
          setConfirmDialog(null)
          setIsDirty(false)
          setMode('preview')
          setEditorContent(null)
          setSelectedPath(path)
          setIsDir(dir)
        },
      })
      return
    }
    setSelectedPath(path)
    setIsDir(dir)
    setMode('preview')
    setIsDirty(false)
    setEditorContent(null)
  }, [isDirty, selectedPath])

  const handleEdit = useCallback(async () => {
    if (!selectedPath || isDir) return
    try {
      const data = await api.get(`/workspace/file?path=${encodeURIComponent(selectedPath)}`)
      if (typeof data.content !== 'string') {
        showToast('Arquivo binário ou muito grande para editar', 'error')
        return
      }
      setEditorContent(data.content)
      setMode('edit')
      setIsDirty(false)
    } catch {
      showToast('Erro ao carregar arquivo para edição', 'error')
    }
  }, [selectedPath, isDir, showToast])

  const handleSave = useCallback(async (content?: string) => {
    if (!selectedPath) return
    const finalContent = content ?? editorRef.current?.getContent() ?? editorContent ?? ''
    try {
      await api.put('/workspace/file', { path: selectedPath, content: finalContent })
      setIsDirty(false)
      showToast('Arquivo salvo')
    } catch {
      showToast('Erro ao salvar arquivo', 'error')
    }
  }, [selectedPath, editorContent, showToast])

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setConfirmDialog({
        variant: 'discard',
        filename: selectedPath?.split('/').pop() ?? '',
        onConfirm: () => {
          setConfirmDialog(null)
          setMode('preview')
          setIsDirty(false)
          setEditorContent(null)
        },
      })
    } else {
      setMode('preview')
      setEditorContent(null)
    }
  }, [isDirty, selectedPath])

  const handleDelete = useCallback(() => {
    if (!selectedPath) return
    const filename = selectedPath.split('/').pop() ?? ''
    setConfirmDialog({
      variant: 'delete',
      filename,
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await api.delete(`/workspace/file?path=${encodeURIComponent(selectedPath)}`)
          setSelectedPath(null)
          setMode('preview')
          setIsDirty(false)
          setEditorContent(null)
          setRefreshTrigger(t => t + 1)
          showToast('Arquivo movido para .trash/')
        } catch {
          showToast('Erro ao excluir arquivo', 'error')
        }
      },
    })
  }, [selectedPath, showToast])

  const handleRename = useCallback(() => {
    if (!selectedPath) return
    const currentName = selectedPath.split('/').pop() ?? ''
    setNameDialog({
      title: 'Renomear',
      placeholder: 'Novo nome',
      defaultValue: currentName,
      onConfirm: async (newName) => {
        setNameDialog(null)
        const dir = selectedPath.split('/').slice(0, -1).join('/')
        const newPath = dir ? `${dir}/${newName}` : newName
        try {
          await api.post('/workspace/rename', { from: selectedPath, to: newPath })
          setSelectedPath(newPath)
          setRefreshTrigger(t => t + 1)
          showToast('Renomeado com sucesso')
        } catch {
          showToast('Erro ao renomear', 'error')
        }
      },
      onCancel: () => setNameDialog(null),
    })
  }, [selectedPath, showToast])

  const handleNewFile = useCallback(() => {
    const base = selectedPath
      ? (isDir ? selectedPath : selectedPath.split('/').slice(0, -1).join('/'))
      : 'workspace'
    setNameDialog({
      title: 'Novo arquivo',
      placeholder: 'nome-do-arquivo.md',
      onConfirm: async (name) => {
        setNameDialog(null)
        const path = `${base}/${name}`
        try {
          await api.post('/workspace/file', { path })
          setRefreshTrigger(t => t + 1)
          setSelectedPath(path)
          setIsDir(false)
          showToast('Arquivo criado')
        } catch {
          showToast('Erro ao criar arquivo', 'error')
        }
      },
      onCancel: () => setNameDialog(null),
    })
  }, [selectedPath, isDir, showToast])

  const handleNewFolder = useCallback(() => {
    const base = selectedPath
      ? (isDir ? selectedPath : selectedPath.split('/').slice(0, -1).join('/'))
      : 'workspace'
    setNameDialog({
      title: 'Nova pasta',
      placeholder: 'nome-da-pasta',
      onConfirm: async (name) => {
        setNameDialog(null)
        const path = `${base}/${name}`
        try {
          await api.post('/workspace/folder', { path })
          setRefreshTrigger(t => t + 1)
          showToast('Pasta criada')
        } catch {
          showToast('Erro ao criar pasta', 'error')
        }
      },
      onCancel: () => setNameDialog(null),
    })
  }, [selectedPath, isDir, showToast])

  const handleDownload = useCallback(async () => {
    if (!selectedPath) return
    try {
      const res = await fetch(`${API_BASE}/api/workspace/download?path=${encodeURIComponent(selectedPath)}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = selectedPath.split('/').pop() ?? 'download'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast('Erro ao baixar arquivo', 'error')
    }
  }, [selectedPath, showToast])

  const handleConfirmOverwrite = useCallback((filename: string): Promise<boolean> => {
    return new Promise(resolve => {
      overwriteResolverRef.current = resolve
      setConfirmDialog({
        variant: 'overwrite',
        filename,
        onConfirm: () => {
          setConfirmDialog(null)
          overwriteResolverRef.current?.(true)
        },
      })
    })
  }, [])

  const pageTitle = selectedPath
    ? `${selectedPath}${isDirty ? ' \u25CF' : ''}`
    : 'Workspace'

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* FileTree */}
      <FileTree
        selectedPath={selectedPath}
        onSelect={handleSelect}
        onNavigate={(path) => handleSelect(path, true)}
        refreshTrigger={refreshTrigger}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* FileToolbar */}
        <FileToolbar
          selectedPath={selectedPath}
          isDir={isDir}
          mode={mode}
          isDirty={isDirty}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onUpload={() => setShowUpload(true)}
          onRefresh={() => setRefreshTrigger(t => t + 1)}
          onEdit={handleEdit}
          onSave={() => handleSave()}
          onCancel={handleCancel}
          onRename={handleRename}
          onDelete={handleDelete}
          onDownload={handleDownload}
        />

        {/* Path title */}
        {selectedPath && (
          <div
            className="px-4 py-2 text-xs font-mono flex items-center gap-2 border-b flex-shrink-0"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-card)',
              color: isDirty ? 'var(--warning)' : 'var(--text-muted)',
            }}
          >
            <span className="truncate">{pageTitle}</span>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {!selectedPath && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div
                  className="mx-auto mb-4 flex items-center justify-center w-16 h-16 rounded-2xl"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <path d="M3 7V5a2 2 0 012-2h6l2 2h8a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Selecione um arquivo para visualizar
                </p>
              </div>
            </div>
          )}

          {selectedPath && !isDir && mode === 'preview' && (
            <FilePreview path={selectedPath} onDownload={handleDownload} />
          )}

          {selectedPath && !isDir && mode === 'edit' && editorContent !== null && (
            <FileEditor
              initialContent={editorContent}
              path={selectedPath}
              onDirtyChange={setIsDirty}
              onSave={handleSave}
              editorRef={editorRef}
            />
          )}

          {selectedPath && isDir && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Selecione um arquivo para visualizar
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {confirmDialog && (
        <ConfirmDialog
          variant={confirmDialog.variant}
          filename={confirmDialog.filename}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => {
            if (confirmDialog.variant === 'overwrite') {
              overwriteResolverRef.current?.(false)
            }
            setConfirmDialog(null)
          }}
        />
      )}

      {nameDialog && <NameDialog {...nameDialog} />}

      {/* Upload dropzone */}
      {(showUpload || showDrag) && (
        <UploadDropzone
          currentPath={selectedPath && isDir ? selectedPath : selectedPath?.split('/').slice(0, -1).join('/') ?? 'workspace'}
          onUploadComplete={() => {
            setRefreshTrigger(t => t + 1)
            showToast('Upload concluído')
          }}
          onClose={() => { setShowUpload(false); setShowDrag(false) }}
          onConfirmOverwrite={handleConfirmOverwrite}
        />
      )}

      {/* Toast container */}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
        style={{ pointerEvents: 'none' }}
        aria-live="polite"
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium"
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${toast.type === 'success' ? 'rgba(0,255,167,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: toast.type === 'success' ? 'var(--evo-green)' : 'var(--danger)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              animation: 'slideInRight 200ms ease-out',
              pointerEvents: 'auto',
            }}
          >
            <CheckCircle size={15} />
            {toast.message}
          </div>
        ))}
      </div>

      {/* Toast animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  )
}
