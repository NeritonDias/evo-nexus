import { useEffect, useRef, useState, useCallback } from 'react'
import { TS_HTTP, TS_WS } from '../lib/terminal-url'

export type NotificationEvent = 'agent_awaiting' | 'agent_finished'

export interface GlobalNotification {
  id: string
  event: NotificationEvent
  sessionId: string
  agentName: string
  toolName?: string
  inputPreview?: string
  createdAt: number
  read: boolean
}

const STORAGE_KEY = 'evonexus.notifications.state'
const MAX_STORED = 50

function loadFromStorage(): GlobalNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Keep only last MAX_STORED
    return parsed.slice(-MAX_STORED)
  } catch {
    return []
  }
}

function saveToStorage(notifications: GlobalNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(-MAX_STORED)))
  } catch {}
}

export function useGlobalNotifications() {
  const [notifications, setNotifications] = useState<GlobalNotification[]>(loadFromStorage)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(1000)
  const mountedRef = useRef(true)

  const upsert = useCallback((notif: GlobalNotification) => {
    setNotifications(prev => {
      // Deduplicate by id
      const exists = prev.findIndex(n => n.id === notif.id)
      let next: GlobalNotification[]
      if (exists >= 0) {
        // Update existing (e.g. re-sent duplicate)
        next = [...prev]
        next[exists] = notif
      } else {
        next = [...prev, notif].slice(-MAX_STORED)
      }
      saveToStorage(next)
      return next
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => {
      const next = prev.filter(n => n.id !== id)
      saveToStorage(next)
      return next
    })
  }, [])

  const dismissBySession = useCallback((sessionId: string) => {
    setNotifications(prev => {
      const next = prev.filter(n => n.sessionId !== sessionId)
      saveToStorage(next)
      return next
    })
  }, [])

  const dismissAll = useCallback(() => {
    setNotifications([])
    saveToStorage([])
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (wsRef.current && wsRef.current.readyState < 2) {
      // CONNECTING or OPEN — skip
      return
    }

    const ws = new WebSocket(`${TS_WS}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectDelayRef.current = 1000
      ws.send(JSON.stringify({ type: 'subscribe_global' }))

      // Seed from pending endpoint
      fetch(`${TS_HTTP}/api/notifications/pending`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!mountedRef.current || !Array.isArray(data?.notifications)) return
          for (const n of data.notifications) {
            upsert(n)
          }
        })
        .catch(() => {})
    }

    ws.onmessage = (ev) => {
      if (!mountedRef.current) return
      let msg: any
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.type !== 'notification') return

      const notif: GlobalNotification = {
        id: msg.id || `${msg.event}-${msg.sessionId}-${msg.createdAt || Date.now()}`,
        event: msg.event,
        sessionId: msg.sessionId,
        agentName: msg.agentName || '',
        toolName: msg.toolName,
        inputPreview: msg.inputPreview,
        createdAt: msg.createdAt || Date.now(),
        read: false,
      }
      upsert(notif)
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      // Exponential backoff, cap at 30s
      const delay = Math.min(reconnectDelayRef.current, 30000)
      reconnectDelayRef.current = Math.min(delay * 2, 30000)
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect()
      }, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [upsert])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, unreadCount, dismiss, dismissBySession, dismissAll }
}
