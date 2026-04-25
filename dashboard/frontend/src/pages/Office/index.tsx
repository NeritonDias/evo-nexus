import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OfficeState } from '../../pixel-office/engine/officeState.js';
import { OfficeCanvasLite } from '../../pixel-office/components/OfficeCanvasLite.js';
import { usePixelOfficeSocket } from './usePixelOfficeSocket.js';

export default function Office() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const osRef = useRef<OfficeState | null>(null);
  const [zoom, setZoom] = useState(2);
  const panRef = useRef({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    osRef.current = new OfficeState();
    setReady(true);
  }, []);

  usePixelOfficeSocket(ready ? osRef.current : null);

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
  let totalIn = 0;
  let totalOut = 0;
  for (const ch of os.characters.values()) {
    totalIn += ch.inputTokens || 0;
    totalOut += ch.outputTokens || 0;
  }
  const activeCount = os.characters.size;

  return (
    <div className="w-full h-[calc(100vh-56px)] flex flex-col bg-[#0C111D]">
      <header className="px-4 py-2 border-b border-slate-800 text-slate-200 text-sm flex items-center justify-between">
        <span>{t('office.title', 'Office — live agent activity')}</span>
        <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
          {wsConnected ? '● live' : '○ reconnecting'}
        </span>
      </header>
      <div className="h-10 flex items-center gap-6 px-4 text-xs text-slate-400 border-b border-slate-900">
        <span>
          {activeCount} {activeCount === 1 ? 'agent' : 'agents'} online
        </span>
        <span>
          {totalIn.toLocaleString()} in · {totalOut.toLocaleString()} out tokens
        </span>
      </div>
      <div className="flex-1 min-h-0 relative">
        <OfficeCanvasLite
          officeState={os}
          onSelect={handleSelect}
          zoom={zoom}
          onZoomChange={setZoom}
          panRef={panRef}
        />
        {activeCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-slate-500 text-sm">
              {t('office.empty', 'Office is quiet. Trigger an agent to see them at work.')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
