import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OfficeState } from '../../pixel-office/engine/officeState.js';
import { OfficeCanvasLite } from '../../pixel-office/components/OfficeCanvasLite.js';
import { ToolOverlay } from '../../pixel-office/components/ToolOverlay.js';
import { NetworkBackground } from './NetworkBackground.js';
import { usePixelOfficeSocket } from './usePixelOfficeSocket.js';
import { RosterPanel } from './RosterPanel.js';
import { setRoster, getPendingQueueSize } from './eventReducer.js';
import { OfficeErrorBoundary } from './ErrorBoundary.js';
import { DebugOverlay } from './DebugOverlay.js';
import { loadAllAssets } from '../../pixel-office/assets/orchestrator.js';

export default function Office() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const osRef = useRef<OfficeState | null>(null);
  // Default zoom 4× — the office is 21x22 tiles (336x352 world px); at zoom 2
  // it filled ~40% of a 1080p viewport, looking sparse. Zoom 4 fills more of
  // the canvas while still leaving room for sub-agents and labels.
  const [zoom, setZoom] = useState(4);
  const panRef = useRef({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);
  const [isNarrow, setIsNarrow] = useState(false);

  // Detect narrow screens (mobile / split panes) and render a list-only
  // fallback. The pixel canvas needs horizontal room for the camera + roster.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 720px)');
    const update = () => setIsNarrow(mql.matches);
    update();
    if (mql.addEventListener) {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    // Safari < 14 fallback
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  // Load all pixel-office assets (sprites + layout + furniture catalog) BEFORE
  // constructing OfficeState so characters render with real sprites (not empty
  // placeholders) and the office uses the shipped default-layout-1.json (not
  // the code-only fallback in createDefaultLayout).
  useEffect(() => {
    let cancelled = false;
    loadAllAssets()
      .then(({ layout }) => {
        if (cancelled) return;
        osRef.current = new OfficeState(layout ?? undefined);
        setReady(true);
      })
      .catch((err) => {
        // Asset load failure must not block the page — fall back to the
        // empty-sprite render so at least the UI shell works.
        // eslint-disable-next-line no-console
        console.error('[pixel-office] loadAllAssets failed, falling back:', err);
        if (cancelled) return;
        osRef.current = new OfficeState();
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the roster on mount and feed it to the event reducer so palette
  // resolution honours each agent's frontmatter color.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{ name: string; description?: string; color?: string; locked?: boolean }>) => {
        if (cancelled || !Array.isArray(data)) return;
        setRoster(
          data
            .filter((a) => !a.locked)
            .map((a) => ({ name: a.name, description: a.description, color: a.color, slug: a.name })),
        );
      })
      .catch(() => {
        /* roster fetch is best-effort — palette falls back to slug hash */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  usePixelOfficeSocket(ready ? osRef.current : null);

  // Seat persistence: fetch saved seat assignments on mount, reconcile periodically
  // while the page is open, and persist on unmount.
  const savedSeatsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch('/api/pixel-office/seats')
      .then((r) => (r.ok ? r.json() : { seats: [] }))
      .then((data: { seats?: Array<{ agent_slug: string; seat_id: string }> }) => {
        if (cancelled || !data || !Array.isArray(data.seats)) return;
        const map = new Map<string, string>();
        for (const s of data.seats) {
          if (s && typeof s.agent_slug === 'string' && typeof s.seat_id === 'string' && s.seat_id) {
            map.set(s.agent_slug, s.seat_id);
          }
        }
        savedSeatsRef.current = map;
      })
      .catch(() => {
        /* best-effort — fall back to default seat assignment */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reconcile loop: when a character is spawned without our preferred seat,
  // ask the engine to reassign. Runs every second; cheap because reassignSeat
  // is a no-op when the character is already at the saved seat.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const os = osRef.current;
      if (!os) return;
      const saved = savedSeatsRef.current;
      if (saved.size === 0) return;
      for (const ch of os.characters.values()) {
        if (!ch.folderName) continue;
        const want = saved.get(ch.folderName);
        if (!want) continue;
        if (ch.seatId === want) continue;
        // Only reassign if the saved seat exists and is free (or is already ours).
        const seat = os.seats.get(want);
        if (!seat) continue;
        if (seat.assigned && ch.seatId !== want) continue;
        os.reassignSeat(ch.id, want);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [ready]);

  // Persist seat assignments on unmount.
  useEffect(() => {
    return () => {
      const os = osRef.current;
      if (!os) return;
      const seats: Array<{
        agent_slug: string;
        seat_id: string;
        palette: number;
        hue_shift: number;
      }> = [];
      for (const ch of os.characters.values()) {
        if (!ch.folderName || !ch.seatId) continue;
        seats.push({
          agent_slug: ch.folderName,
          seat_id: ch.seatId,
          palette: ch.palette,
          hue_shift: ch.hueShift || 0,
        });
      }
      if (seats.length > 0) {
        fetch('/api/pixel-office/seats', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seats }),
        }).catch(() => {
          /* best-effort — unmount fire-and-forget */
        });
      }
    };
  }, []);

  // Re-render every second to refresh metrics display (cheap: no canvas redraw)
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll WS readiness via a heartbeat on the socket hook's internals would be
  // ideal, but we approximate: if we see any event in the last 5s we're live.
  // For v1 we simply probe the endpoint via fetch('/api/pixel-office/snapshot')
  // on each tick — it returns 200 only when the dashboard is up and we're authed.
  useEffect(() => {
    let closed = false;
    const probe = async () => {
      try {
        const r = await fetch('/api/pixel-office/snapshot');
        if (!closed) setWsConnected(r.ok);
      } catch {
        if (!closed) setWsConnected(false);
      }
    };
    probe();
    const id = window.setInterval(probe, 5000);
    return () => {
      closed = true;
      clearInterval(id);
    };
  }, []);

  const handleSelect = useCallback(
    (agentId: number | null) => {
      if (agentId === null || !osRef.current) return;
      const ch = osRef.current.characters.get(agentId);
      if (ch?.folderName) {
        navigate(`/agents/${ch.folderName}`);
      }
    },
    [navigate],
  );

  if (!ready || !osRef.current) {
    return <div className="p-4 text-slate-400">{t('office.loading', 'Loading office…')}</div>;
  }

  const os = osRef.current;
  void tick; // force re-render for the metrics below
  const debugEnabled =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';
  let totalIn = 0;
  let totalOut = 0;
  for (const ch of os.characters.values()) {
    totalIn += ch.inputTokens || 0;
    totalOut += ch.outputTokens || 0;
  }
  const activeCount = os.characters.size;
  // Surfaced from the reducer so the user knows agents are spawning past the cap.
  const queuedCount = getPendingQueueSize();

  // ── Shared chrome bits ──────────────────────────────────────────────
  const StatusPill = (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide uppercase border ${
        wsConnected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      }`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
        }`}
      />
      {wsConnected ? t('office.live', 'live') : t('office.reconnecting', 'reconnecting')}
    </span>
  );

  // Narrow-screen fallback: skip the canvas (which expects a wide viewport)
  // and show the roster list full-width with a notice.
  if (isNarrow) {
    return (
      <div className="relative w-full h-[calc(100vh-56px)] flex flex-col bg-[#080c14] overflow-hidden font-[Inter,-apple-system,sans-serif]">
        <NetworkBackground />
        <header
          role="banner"
          className="relative z-10 px-5 py-3 border-b border-[#152030] bg-[#0b1018]/80 backdrop-blur-sm flex items-center justify-between"
        >
          <div>
            <h1 className="text-sm font-semibold text-slate-100 tracking-tight">
              {t('office.title', 'Office')}
            </h1>
            <p className="text-[11px] text-[#4a5a6e] mt-0.5">
              {t('office.subtitle', 'Live agent activity')}
            </p>
          </div>
          {StatusPill}
        </header>
        <div className="relative z-10 px-5 py-3 bg-amber-500/5 border-b border-amber-500/20 text-amber-300 text-xs">
          {t('office.narrow', 'Pixel Office needs a wider screen — showing the roster list instead.')}
        </div>
        <div className="relative z-10 flex-1 min-h-0">
          <RosterPanel
            officeState={os}
            onSelect={(id) => {
              os.selectedAgentId = id;
              os.cameraFollowId = id;
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-56px)] flex flex-col bg-[#080c14] overflow-hidden font-[Inter,-apple-system,sans-serif]">
      <NetworkBackground />
      <header
        role="banner"
        className="relative z-10 px-5 py-3 border-b border-[#152030] bg-[#0b1018]/80 backdrop-blur-sm flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-sm font-semibold text-slate-100 tracking-tight">
              {t('office.title', 'Office')}
            </h1>
            <p className="text-[11px] text-[#4a5a6e] mt-0.5">
              {t('office.subtitle', 'Live agent activity')}
            </p>
          </div>
          <span className="hidden md:inline-block w-px h-8 bg-[#152030]" aria-hidden="true" />
          <div className="hidden md:flex items-center gap-5 text-[11px]">
            <span aria-live="polite" className="text-slate-300">
              <span className="text-emerald-400 font-semibold">{activeCount}</span>
              <span className="ml-1.5 text-[#4a5a6e]">
                {activeCount === 1 ? t('office.agentOnline', 'agent') : t('office.agentsOnline', 'agents')}
              </span>
            </span>
            <span aria-live="polite" className="text-slate-300">
              <span className="font-semibold tabular-nums">{totalIn.toLocaleString()}</span>
              <span className="text-[#4a5a6e] ml-1">in</span>
              <span className="text-[#2d3d4f] mx-1">·</span>
              <span className="font-semibold tabular-nums">{totalOut.toLocaleString()}</span>
              <span className="text-[#4a5a6e] ml-1">out</span>
            </span>
          </div>
        </div>
        {StatusPill}
      </header>

      <div className="relative z-10 flex-1 min-h-0 flex p-4 gap-4">
        {/* Roster panel — own card */}
        <div className="rounded-xl border border-[#152030] bg-[#0b1018]/95 shadow-[0_4px_30px_rgba(0,0,0,0.35)] overflow-hidden">
          <RosterPanel
            officeState={os}
            onSelect={(id) => {
              os.selectedAgentId = id;
              os.cameraFollowId = id;
            }}
          />
        </div>

        {/* Canvas card */}
        <div
          className="po-office-card flex-1 min-w-0 relative rounded-xl border border-[#152030] bg-[#0b1018] shadow-[0_4px_40px_rgba(0,0,0,0.45)] overflow-hidden"
          role="img"
          aria-label={t('office.title', 'Office — live agent activity')}
        >
          <OfficeErrorBoundary>
            <OfficeCanvasLite
              officeState={os}
              onSelect={handleSelect}
              zoom={zoom}
              onZoomChange={setZoom}
              panRef={panRef}
            />
            <ToolOverlay officeState={os} zoom={zoom} panRef={panRef} />
          </OfficeErrorBoundary>

          {queuedCount > 0 && (
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium pointer-events-none shadow-lg backdrop-blur-sm">
              {t('office.queued', '+{{count}} agents queued', { count: queuedCount })}
            </div>
          )}
          {debugEnabled && <DebugOverlay officeState={os} wsConnected={wsConnected} />}

          {/* Hint card — bottom-right corner, very subtle */}
          <div className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-md bg-[#080c14]/80 border border-[#152030] text-[10px] text-[#4a5a6e] pointer-events-none backdrop-blur-sm">
            <kbd className="px-1 py-0.5 rounded bg-[#152030] text-[#a0aec0] text-[9px] font-mono">Ctrl</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1 py-0.5 rounded bg-[#152030] text-[#a0aec0] text-[9px] font-mono">Wheel</kbd>
            <span className="ml-2 text-[#2d3d4f]">zoom</span>
            <span className="mx-2 text-[#2d3d4f]">·</span>
            <kbd className="px-1 py-0.5 rounded bg-[#152030] text-[#a0aec0] text-[9px] font-mono">middle-click</kbd>
            <span className="ml-1.5 text-[#2d3d4f]">pan</span>
          </div>

          {activeCount === 0 && (
            <div
              role="status"
              aria-label="Office is empty"
              className="absolute inset-0 flex items-center justify-center pointer-events-none p-6"
            >
              <div
                className="max-w-md w-full px-7 py-6 rounded-xl border border-[#152030] bg-[#0b1018]/90 backdrop-blur-md shadow-[0_4px_30px_rgba(0,0,0,0.5)] text-center"
                style={{ pointerEvents: 'auto' }}
              >
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                </div>
                <h2 className="text-base font-semibold text-slate-100 mb-1.5">
                  {t('office.empty', 'Office is quiet')}
                </h2>
                <p className="text-[11px] leading-relaxed text-[#a0aec0]">
                  {t(
                    'office.emptyHelp',
                    'Each character is an active Claude session. The 38 agents in the sidebar enter the office when invoked — via a routine, trigger, heartbeat, or terminal chat.',
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
