import { useState } from 'react'
import { X, Copy, Check, Share2, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'

interface ShareDialogProps {
  path: string
  onClose: () => void
}

const EXPIRY_OPTIONS = [
  { value: '1h', label: '1 hora' },
  { value: '24h', label: '24 horas' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: null, label: 'Sem expiração' },
]

export default function ShareDialog({ path, onClose }: ShareDialogProps) {
  const [expiresIn, setExpiresIn] = useState<string | null>('7d')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.post('/shares', { path, expires_in: expiresIn })
      // Build the full public URL using the current host
      const base = `${window.location.protocol}//${window.location.host}`
      setShareUrl(`${base}/share/${data.token}`)
    } catch {
      setError('Erro ao criar link de compartilhamento. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            <Share2 size={16} style={{ color: 'var(--evo-green)' }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              Compartilhar arquivo
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--surface-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Filename */}
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Arquivo</p>
            <p
              className="text-sm font-mono px-3 py-2 rounded-lg truncate"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              title={path}
            >
              {path}
            </p>
          </div>

          {/* Expiration selector — only show before link is generated */}
          {!shareUrl && (
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>Expiração</p>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.value)}
                    onClick={() => setExpiresIn(opt.value)}
                    className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                    style={{
                      background: expiresIn === opt.value ? 'rgba(0,255,167,0.15)' : 'var(--bg-primary)',
                      color: expiresIn === opt.value ? 'var(--evo-green)' : 'var(--text-secondary)',
                      border: `1px solid ${expiresIn === opt.value ? 'rgba(0,255,167,0.4)' : 'var(--border)'}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              {error}
            </p>
          )}

          {/* Generated URL */}
          {shareUrl && (
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>Link público gerado</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onClick={(e) => e.currentTarget.select()}
                  className="flex-1 text-xs px-3 py-2 rounded-lg outline-none font-mono"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--evo-green)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
                  style={{
                    background: copied ? 'rgba(0,255,167,0.15)' : 'var(--bg-primary)',
                    color: copied ? 'var(--evo-green)' : 'var(--text-secondary)',
                    border: `1px solid ${copied ? 'rgba(0,255,167,0.4)' : 'var(--border)'}`,
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-5 py-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {shareUrl ? 'Fechar' : 'Cancelar'}
          </button>
          {!shareUrl && (
            <button
              onClick={handleCreate}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                background: loading ? 'rgba(0,255,167,0.5)' : 'var(--evo-green)',
                color: '#0C111D',
                opacity: loading ? 0.7 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              Gerar link
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
