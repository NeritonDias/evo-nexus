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
        className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 ${
          isActive
            ? 'bg-emerald-500/[0.06] hover:bg-emerald-500/10 text-slate-100'
            : 'hover:bg-[#101824] text-[#a0aec0]'
        }`}
        title={a.description}
      >
        <span className="relative shrink-0" aria-label={isActive ? 'active' : 'idle'}>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: isActive ? '#22c55e' : '#2d3d4f' }}
          />
          {isActive && (
            <span
              className="absolute inset-0 w-1.5 h-1.5 rounded-full animate-ping"
              style={{ background: '#22c55e', opacity: 0.6 }}
            />
          )}
        </span>
        <span className="flex-1 truncate font-medium">{a.name}</span>
        <span
          className="inline-block w-1 h-3 rounded-full shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
          style={{ background: a.color || deptColor }}
          aria-hidden="true"
        />
      </li>
    );
  };

  // Header counts
  const total = roster.length;
  const onlineTotal = roster.filter((a) => active.has(a.name)).length;

  return (
    <aside className="w-64 shrink-0 h-full overflow-y-auto bg-transparent">
      <header className="px-4 pt-4 pb-3 border-b border-[#152030] sticky top-0 bg-[#0b1018]/95 backdrop-blur-sm z-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] uppercase tracking-widest font-semibold text-[#4a5a6e]">
            Agents
          </h2>
          <span className="text-[10px] tabular-nums text-[#4a5a6e]">
            <span className="text-emerald-400 font-semibold">{onlineTotal}</span>
            <span className="mx-1 text-[#2d3d4f]">/</span>
            <span>{total}</span>
          </span>
        </div>
      </header>
      <div className="py-2">
        {departments.map((dept) => {
          const list = byDept.get(dept.id);
          if (!list || list.length === 0) return null;
          const onlineInDept = list.filter((a) => active.has(a.name)).length;
          return (
            <section key={dept.id} className="mb-1.5">
              <header
                className="flex items-center justify-between px-4 pt-3 pb-1.5"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-1 h-3.5 rounded-full"
                    style={{ background: dept.color }}
                  />
                  <span
                    className="text-[10px] uppercase tracking-widest font-semibold"
                    style={{ color: dept.color }}
                  >
                    {dept.label}
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-[#4a5a6e]">
                  {onlineInDept > 0 && (
                    <span className="text-emerald-400 font-semibold">{onlineInDept}</span>
                  )}
                  {onlineInDept > 0 && <span className="mx-0.5 text-[#2d3d4f]">/</span>}
                  <span>{list.length}</span>
                </span>
              </header>
              <ul className="px-2 space-y-0.5">
                {list.map((a) => renderAgent(a, dept.color))}
              </ul>
            </section>
          );
        })}
        {unplaced.length > 0 && (
          <section className="mb-1.5">
            <header className="flex items-center gap-2 px-4 pt-3 pb-1.5">
              <span className="inline-block w-1 h-3.5 rounded-full bg-slate-600" />
              <span className="text-[10px] uppercase tracking-widest font-semibold text-[#4a5a6e]">
                Other
              </span>
            </header>
            <ul className="px-2 space-y-0.5">
              {unplaced.map((a) => renderAgent(a, '#64748b'))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
