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

interface Department {
  id: string;
  label: string;
  color: string;
  agents: string[];
  count: number;
}

interface Props {
  officeState: OfficeState;
  onSelect: (agentId: number | null) => void;
}

/**
 * Left-column sidebar for the Office page.
 *
 * Fetches /api/agents AND /api/pixel-office/departments on mount so it can
 * group agents into the same department buckets the canvas renders as
 * separate rooms. Unmapped slugs (custom agents, future additions) fall
 * into a final "Other" group.
 */
export function RosterPanel({ officeState, onSelect }: Props) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/agents').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/pixel-office/departments').then((r) => (r.ok ? r.json() : { departments: [] })),
    ])
      .then(([agentList, deptResp]) => {
        if (cancelled) return;
        setRoster(Array.isArray(agentList) ? agentList : []);
        const depts = (deptResp && Array.isArray(deptResp.departments)) ? deptResp.departments : [];
        setDepartments(depts);
      })
      .catch(() => {
        if (!cancelled) {
          setRoster([]);
          setDepartments([]);
        }
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

  // Group roster entries by department. Unmapped agents fall into "Other".
  const byDept = new Map<string, RosterEntry[]>();
  const slugToEntry = new Map<string, RosterEntry>();
  for (const a of roster) slugToEntry.set(a.name, a);
  for (const dept of departments) {
    const list: RosterEntry[] = [];
    for (const slug of dept.agents) {
      const entry = slugToEntry.get(slug);
      if (entry) list.push(entry);
    }
    if (list.length > 0) byDept.set(dept.id, list);
  }
  // Anything in roster but not in any department goes under "other".
  const placedSlugs = new Set<string>();
  for (const dept of departments) for (const slug of dept.agents) placedSlugs.add(slug);
  const unplaced = roster.filter((a) => !placedSlugs.has(a.name));

  const activate = (slug: string) => {
    for (const [id, ch] of officeState.characters) {
      if (ch.folderName === slug) {
        onSelect(id);
        return;
      }
    }
  };

  const renderAgent = (a: RosterEntry, deptColor: string) => {
    const isActive = active.has(a.name);
    const statusDot = isActive ? '#22c55e' : '#475569';
    return (
      <li
        key={a.name}
        role="button"
        tabIndex={0}
        aria-label={a.name}
        onClick={() => activate(a.name)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate(a.name);
          }
        }}
        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 focus:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer text-sm"
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
          style={{ background: a.color || deptColor }}
          aria-hidden="true"
        />
      </li>
    );
  };

  // Total count for the header.
  const total = roster.length;

  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 overflow-y-auto bg-[#0C111D]">
      <header className="px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
        Agents ({total})
      </header>
      <div className="pb-4">
        {departments.map((dept) => {
          const list = byDept.get(dept.id);
          if (!list || list.length === 0) return null;
          const onlineInDept = list.filter((a) => active.has(a.name)).length;
          return (
            <section key={dept.id} className="mb-3">
              <header
                className="flex items-center justify-between px-4 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-l-2"
                style={{ borderLeftColor: dept.color, color: dept.color }}
              >
                <span>{dept.label}</span>
                <span className="text-slate-500 normal-case tracking-normal">
                  {onlineInDept}/{list.length}
                </span>
              </header>
              <ul className="px-2 space-y-0.5 mt-1">
                {list.map((a) => renderAgent(a, dept.color))}
              </ul>
            </section>
          );
        })}
        {unplaced.length > 0 && (
          <section className="mb-3">
            <header className="px-4 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-slate-500 border-l-2 border-slate-600">
              Other
            </header>
            <ul className="px-2 space-y-0.5 mt-1">
              {unplaced.map((a) => renderAgent(a, '#64748b'))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
