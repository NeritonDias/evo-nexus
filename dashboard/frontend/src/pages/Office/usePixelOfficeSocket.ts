import { useEffect, useRef } from 'react';
import type { OfficeState } from '../../pixel-office/engine/officeState.js';
import { applyEvent, type PixelOfficeEvent } from './eventReducer.js';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const POLL_INTERVAL_MS = 3_000;

interface SnapshotSession {
  agent: string;
  started_at: string;
  tool: string | null;
  input_tokens: number;
  output_tokens: number;
  waiting?: boolean;
}

/** Consumes /api/pixel-office/snapshot on connect to reconstruct prior state.
 *  Silently no-op if the endpoint is missing (503 during deploys, 401 pre-login). */
async function replaySnapshot(os: OfficeState): Promise<void> {
  try {
    const r = await fetch('/api/pixel-office/snapshot');
    if (!r.ok) return;
    const { sessions } = (await r.json()) as { sessions: Record<string, SnapshotSession> };
    for (const [sid, info] of Object.entries(sessions)) {
      applyEvent(os, { type: 'agent_started', agent: info.agent, session_id: sid, ts: info.started_at });
      if (info.tool) {
        applyEvent(os, {
          type: 'tool_started',
          agent: info.agent,
          session_id: sid,
          tool: info.tool,
          ts: info.started_at,
        });
      }
      if (info.input_tokens || info.output_tokens) {
        applyEvent(os, {
          type: 'token_usage',
          session_id: sid,
          input_tokens: info.input_tokens,
          output_tokens: info.output_tokens,
          ts: info.started_at,
        });
      }
      if (info.waiting) {
        applyEvent(os, { type: 'waiting_input', agent: info.agent, session_id: sid, ts: info.started_at });
      }
    }
  } catch {
    /* ignore — visualization is best-effort */
  }
}

/** Wires the office canvas to the event bus:
 *  1. Replays snapshot on mount.
 *  2. Opens WebSocket; on disconnect, falls back to polling /api/agents/active.
 *  3. Reconnects with exponential backoff (500ms → 15s).
 *  4. After 3 failed WebSocket reconnects, switches to SSE (/api/pixel-office/sse)
 *     for environments where WebSocket is blocked (proxies, restrictive firewalls). */
export function usePixelOfficeSocket(os: OfficeState | null): void {
  const retryRef = useRef(RECONNECT_MIN_MS);
  const pollTimer = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsFailures = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!os) return;
    let closed = false;

    const startPolling = () => {
      if (pollTimer.current !== null) return;
      pollTimer.current = window.setInterval(async () => {
        try {
          const r = await fetch('/api/agents/active');
          if (!r.ok) return;
          const data = await r.json();
          const active: Array<{ agent: string; started_at: string }> = data.active_agents ?? [];
          for (const a of active) {
            applyEvent(os, {
              type: 'agent_started',
              agent: a.agent,
              session_id: `poll:${a.agent}`,
              ts: a.started_at,
            });
          }
        } catch {
          /* ignore */
        }
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollTimer.current !== null) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const switchToSSE = () => {
      if (closed || esRef.current) return;
      let es: EventSource;
      try {
        es = new EventSource('/api/pixel-office/sse');
      } catch {
        return;
      }
      esRef.current = es;
      es.onopen = () => {
        stopPolling();
      };
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as PixelOfficeEvent;
          applyEvent(os, evt);
        } catch {
          /* drop malformed */
        }
      };
      es.onerror = () => {
        /* EventSource auto-retries; keep polling fallback active in the meantime */
        startPolling();
      };
    };

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/pixel-office`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        startPolling();
        wsFailures.current += 1;
        if (wsFailures.current >= 3) {
          switchToSSE();
          return;
        }
        setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, RECONNECT_MAX_MS);
        return;
      }
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        wsFailures.current = 0;
        retryRef.current = RECONNECT_MIN_MS;
        stopPolling();
      };
      ws.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as PixelOfficeEvent;
          applyEvent(os, evt);
        } catch {
          /* drop malformed */
        }
      };
      ws.onerror = () => {
        /* onclose will fire next */
      };
      ws.onclose = () => {
        if (closed) return;
        if (!opened) {
          wsFailures.current += 1;
        }
        startPolling();
        if (wsFailures.current >= 3) {
          switchToSSE();
          return;
        }
        const delay = retryRef.current;
        retryRef.current = Math.min(retryRef.current * 2, RECONNECT_MAX_MS);
        setTimeout(connect, delay);
      };
    };

    void replaySnapshot(os).then(() => {
      if (!closed) connect();
    });

    return () => {
      closed = true;
      stopPolling();
      wsRef.current?.close();
      esRef.current?.close();
      esRef.current = null;
    };
  }, [os]);
}
