import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface AgentTerminalProps {
  agent: string
  workingDir?: string
}

const CC_WEB_HTTP = import.meta.env.DEV
  ? 'http://localhost:32352'
  : `${window.location.protocol}//${window.location.hostname}:32352`

const CC_WEB_WS = import.meta.env.DEV
  ? 'ws://localhost:32352'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:32352`

type Status = 'connecting' | 'ready' | 'starting' | 'running' | 'error' | 'exited'

export default function AgentTerminal({ agent, workingDir }: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Mount xterm once
  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#00FFA7',
        black: '#484f58',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#a5d6ff',
        white: '#b1bac4',
      },
      scrollback: 5000,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    try { fit.fit() } catch {}
    termRef.current = term
    fitRef.current = fit

    const onResize = () => {
      try {
        fit.fit()
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows,
          }))
        }
      } catch {}
    }
    window.addEventListener('resize', onResize)

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    return () => {
      window.removeEventListener('resize', onResize)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // Connect / start session for this agent
  useEffect(() => {
    let cancelled = false
    const term = termRef.current
    if (!term) return

    async function run() {
      setStatus('connecting')
      setErrorMsg(null)
      term!.clear()

      // 1) Find-or-create session for this agent
      let sessionId: string
      let alreadyActive = false
      try {
        const res = await fetch(`${CC_WEB_HTTP}/api/sessions/for-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentName: agent, workingDir }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        sessionId = data.sessionId
        alreadyActive = !!data.session?.active
      } catch (e: any) {
        if (cancelled) return
        setStatus('error')
        setErrorMsg(`Could not reach cc-web at ${CC_WEB_HTTP}. Is it running?`)
        return
      }

      if (cancelled) return
      sessionIdRef.current = sessionId

      // 2) Open WS
      const ws = new WebSocket(`${CC_WEB_WS}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_session', sessionId }))
      }

      ws.onmessage = (ev) => {
        if (cancelled) return
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }

        switch (msg.type) {
          case 'session_joined': {
            // Replay any buffered output
            if (Array.isArray(msg.outputBuffer)) {
              msg.outputBuffer.forEach((chunk: string) => term!.write(chunk))
            }
            // If an agent is already running in this session, just attach
            if (msg.active || alreadyActive) {
              setStatus('running')
              // Nudge a resize so the pty matches the current terminal size
              const fit = fitRef.current
              if (fit) {
                try { fit.fit() } catch {}
                ws.send(JSON.stringify({ type: 'resize', cols: term!.cols, rows: term!.rows }))
              }
            } else {
              // Start Claude with --agent <agent>
              setStatus('starting')
              ws.send(JSON.stringify({
                type: 'start_claude',
                options: {
                  dangerouslySkipPermissions: true,
                  agent,
                },
              }))
            }
            break
          }
          case 'output':
            term!.write(msg.data)
            break
          case 'claude_started':
            setStatus('running')
            // resize after start
            {
              const fit = fitRef.current
              if (fit) {
                try { fit.fit() } catch {}
                ws.send(JSON.stringify({ type: 'resize', cols: term!.cols, rows: term!.rows }))
              }
            }
            break
          case 'exit':
            setStatus('exited')
            term!.write(`\r\n\x1b[33m[Process exited${msg.code != null ? ` with code ${msg.code}` : ''}]\x1b[0m\r\n`)
            break
          case 'error':
            setStatus('error')
            setErrorMsg(msg.message || 'Unknown error')
            term!.write(`\r\n\x1b[31m[Error] ${msg.message || ''}\x1b[0m\r\n`)
            break
          case 'pong':
            break
        }
      }

      ws.onerror = () => {
        if (cancelled) return
        setStatus('error')
        setErrorMsg('WebSocket error')
      }

      ws.onclose = () => {
        if (pingRef.current) {
          clearInterval(pingRef.current)
          pingRef.current = null
        }
      }

      // Keepalive
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 25000)
    }

    run()

    return () => {
      cancelled = true
      if (pingRef.current) {
        clearInterval(pingRef.current)
        pingRef.current = null
      }
      if (wsRef.current) {
        try { wsRef.current.close() } catch {}
        wsRef.current = null
      }
    }
  }, [agent, workingDir])

  return (
    <div className="relative flex h-full w-full flex-col rounded-xl border border-[#344054] bg-[#0d1117] overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-[#21262d] bg-[#161b22] text-[11px]">
        <div className="flex items-center gap-2 text-[#8b949e]">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor:
                status === 'running' ? '#22C55E' :
                status === 'starting' || status === 'connecting' ? '#F59E0B' :
                status === 'error' ? '#ef4444' :
                status === 'exited' ? '#6B7280' : '#6B7280',
              boxShadow: status === 'running' ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
            }}
          />
          <span>
            {status === 'connecting' && 'Connecting…'}
            {status === 'starting' && 'Starting Claude…'}
            {status === 'running' && `claude --agent ${agent}`}
            {status === 'error' && 'Error'}
            {status === 'exited' && 'Exited'}
          </span>
        </div>
        {errorMsg && (
          <span className="text-[#ef4444] truncate max-w-[60%]" title={errorMsg}>
            {errorMsg}
          </span>
        )}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 p-2" />
    </div>
  )
}
