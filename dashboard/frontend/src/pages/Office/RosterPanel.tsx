import { useEffect, useState } from 'react';
import type { OfficeState } from '../../pixel-office/engine/officeState.js';

/**
 * Roster entry as returned by /api/agents.
 * The endpoint returns a flat array of objects with these fields; `name` is
 * the agent slug (e.g. "bolt-executor"), which matches `Character.folderName`
 * for live-status correlation.
 */
interface RosterEntry {
  name: string;
  description: string;
  color?: string;
  locked: boolean;
}

interface Props {
  officeState: OfficeState;
  onSelect: (agentId: number | null) => void;
}

/**
 * Left-column sidebar for the Office page.
 *
 * - Fetches /api/agents on mount (existing endpoint — see Phase 16.1 note in
 *   the implementation plan: prefer /api/agents over /api/pixel-office/roster).
 * - Tick re-render every second so the active dot reflects current presence
 *   in `officeState.characters` (cheap — no canvas redraw).
 * - Click → finds the character whose `folderName === slug` and selects /
 *   camera-follows it via the parent's `onSelect(agentId)` handler.
 */
export function RosterPanel({ officeState, onSelect }: Props) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: RosterEntry[]) => {
        if (cancelled) return;
        setRoster(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      });
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Build the "currently in the office" set from live OfficeState characters.
  const active = new Set<string>();
  for (const ch of officeState.characters.values()) {
    if (ch.folderName) active.add(ch.folderName);
  }
  void tick; // force a re-render every second

  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 overflow-y-auto bg-[#0C111D]">
      <header className="px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
        Agents ({roster.length})
      </header>
      <ul className="px-2 pb-4 space-y-0.5">
        {roster.map((a) => {
          const isActive = active.has(a.name);
          const statusDot = isActive ? '#22c55e' : '#475569';
          const colorDot = a.color || '#64748b';
          return (
            <li
              key={a.name}
              onClick={() => {
                for (const [id, ch] of officeState.characters) {
                  if (ch.folderName === a.name) {
                    onSelect(id);
                    return;
                  }
                }
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer text-sm"
              title={a.description}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: statusDot }}
                aria-label={isActive ? 'active' : 'idle'}
              />
              <span className="flex-1 text-slate-200 truncate">{a.name}</span>
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: colorDot }}
                aria-hidden="true"
              />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
