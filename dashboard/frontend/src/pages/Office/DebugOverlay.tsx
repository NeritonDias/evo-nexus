import { useEffect, useState } from 'react';
import type { OfficeState } from '../../pixel-office/engine/officeState.js';

interface Props {
  officeState: OfficeState;
  wsConnected: boolean;
}

export function DebugOverlay({ officeState, wsConnected }: Props) {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className="absolute top-2 right-2 px-3 py-2 rounded bg-black/80 text-emerald-400 text-xs font-mono pointer-events-none"
      style={{ zIndex: 50 }}
    >
      <div>FPS: {fps}</div>
      <div>Characters: {officeState.characters.size}</div>
      <div>WS: {wsConnected ? 'live' : 'reconnecting'}</div>
    </div>
  );
}
