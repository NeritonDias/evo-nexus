import type { OfficeState } from '../../pixel-office/engine/officeState.js';
import { paletteForAgent } from '../../pixel-office/agentIdentity.js';
import { MAX_VISIBLE_CHARACTERS } from '../../pixel-office/constants.js';

/** Matches the shape of /api/agents entries (`name` is the agent slug). */
export type RosterEntry = {
  name: string;
  description?: string;
  color?: string;
  /** Optional explicit slug; falls back to `name` when absent. */
  slug?: string;
};

const roster = new Map<string, RosterEntry>();

export function setRoster(entries: RosterEntry[]): void {
  roster.clear();
  for (const e of entries) {
    const key = e.slug ?? e.name;
    if (key) roster.set(key, e);
  }
}

export type PixelOfficeEvent =
  | { type: 'agent_started'; agent: string; session_id: string; ts: string }
  | { type: 'agent_stopped'; session_id: string; agent?: string; ts: string }
  | { type: 'tool_started'; session_id: string; agent: string; tool: string; ts: string }
  | { type: 'tool_finished'; session_id: string; agent: string; tool: string; ts: string }
  | { type: 'waiting_input'; session_id: string; agent?: string; message?: string; ts: string }
  | { type: 'notification'; message: string; ts: string }
  | { type: 'token_usage'; session_id: string; input_tokens: number; output_tokens: number; ts: string }
  | { type: 'subagent_started'; parent_session_id: string; parent_tool_id: string; subagent_type: string; ts: string }
  | { type: 'subagent_finished'; parent_session_id: string; parent_tool_id: string; ts: string };

// Stable mapping session_id → character id so repeated events hit the same char.
const sessionToId = new Map<string, number>();
// Dedup: ONE character per agent slug, even if multiple session_ids are
// concurrently active for that agent. Without this, every Oracle chat
// session showed up twice (chat-bridge emits 'chat-<sid>', JSONL watcher
// emits the actual UUID — two distinct session_ids, both agent='oracle').
const agentToId = new Map<string, number>();
// Refcount per agent slug: tracks how many session_ids currently anchor
// each character. We only despawn when this hits 0, so flash sessions
// (subagents that respond with one-line text in <1 s) stay visible until
// the linger timeout fires.
const agentRefcount = new Map<string, number>();
// When an agent's refcount hits 0, schedule despawn LINGER_MS later. If
// a new session for the same agent arrives before the timeout, cancel
// and keep the character. Without this, subagent spawns flicker on/off
// faster than a human eye can track.
const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>();
const LINGER_MS = 5000;
let nextId = 1;

/**
 * Pending `agent_started` events held back when the office is at capacity.
 * Drained FIFO by `agent_stopped` once a slot frees. Each entry preserves the
 * original session_id so the eventual spawn keeps a stable id across events.
 */
type QueuedSpawn = { agent: string; session_id: string };
const pendingQueue: QueuedSpawn[] = [];

function resolveId(sessionId: string): number {
  let id = sessionToId.get(sessionId);
  if (id === undefined) {
    id = nextId++;
    sessionToId.set(sessionId, id);
  }
  return id;
}

/**
 * Live characters = on-screen, not despawning. Despawning characters are
 * about to disappear so they no longer count toward the cap (this lets the
 * next queued agent spawn the moment its predecessor is told to stop).
 */
function liveCharacterCount(os: OfficeState): number {
  let n = 0;
  for (const ch of os.characters.values()) {
    if (ch.matrixEffect !== 'despawn') n++;
  }
  return n;
}

function spawnAgent(os: OfficeState, agent: string, sessionId: string): void {
  // Reuse the existing character for this agent slug if any session is
  // already active for it. Cancel any pending despawn (the agent is back).
  const existingTimer = lingerTimers.get(agent);
  if (existingTimer) {
    clearTimeout(existingTimer);
    lingerTimers.delete(agent);
  }
  const existingId = agentToId.get(agent);
  if (existingId !== undefined) {
    sessionToId.set(sessionId, existingId);
    agentRefcount.set(agent, (agentRefcount.get(agent) || 0) + 1);
    return;
  }
  const id = resolveId(sessionId);
  agentToId.set(agent, id);
  agentRefcount.set(agent, 1);
  const entry = roster.get(agent);
  const { palette, hueShift } = paletteForAgent(agent, { color: entry?.color });
  os.addAgent(id, palette, hueShift, undefined, false, agent);
}

/** Decrement agent refcount; despawn (with linger) when it reaches zero. */
function dropAgentRef(os: OfficeState, agent: string): void {
  const count = (agentRefcount.get(agent) || 0) - 1;
  if (count > 0) {
    agentRefcount.set(agent, count);
    return;
  }
  agentRefcount.delete(agent);
  const id = agentToId.get(agent);
  if (id === undefined) return;
  // Hold the character on screen LINGER_MS so flash sessions are visible.
  const t = setTimeout(() => {
    lingerTimers.delete(agent);
    if ((agentRefcount.get(agent) || 0) === 0) {
      os.removeAgent(id);
      agentToId.delete(agent);
      drainQueue(os);
    }
  }, LINGER_MS);
  lingerTimers.set(agent, t);
}

/** Drain queued spawns until the cap is reached again. */
function drainQueue(os: OfficeState): void {
  while (pendingQueue.length > 0 && liveCharacterCount(os) < MAX_VISIBLE_CHARACTERS) {
    const next = pendingQueue.shift()!;
    spawnAgent(os, next.agent, next.session_id);
  }
}

/** Number of queued agents waiting for a slot. UI reads this for the overlay. */
export function getPendingQueueSize(): number {
  return pendingQueue.length;
}

export function applyEvent(os: OfficeState, evt: PixelOfficeEvent): void {
  switch (evt.type) {
    case 'agent_started': {
      // If the session is already tracked (replay / duplicate), skip.
      if (sessionToId.has(evt.session_id)) {
        spawnAgent(os, evt.agent, evt.session_id); // no-op if already added
        break;
      }
      // Cap reached → queue and wait for a slot to free.
      if (liveCharacterCount(os) >= MAX_VISIBLE_CHARACTERS) {
        pendingQueue.push({ agent: evt.agent, session_id: evt.session_id });
        break;
      }
      spawnAgent(os, evt.agent, evt.session_id);
      break;
    }
    case 'agent_stopped': {
      // Queued (never spawned)? Just drop from the queue.
      const queuedIdx = pendingQueue.findIndex((q) => q.session_id === evt.session_id);
      if (queuedIdx !== -1) {
        pendingQueue.splice(queuedIdx, 1);
        break;
      }
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) break;
      sessionToId.delete(evt.session_id);
      // Find the agent slug this id belongs to and refcount it down. If
      // other sessions still hold the slug, the character stays put.
      let stoppedAgent: string | undefined;
      for (const [agent, aid] of agentToId.entries()) {
        if (aid === id) { stoppedAgent = agent; break; }
      }
      if (stoppedAgent) {
        dropAgentRef(os, stoppedAgent);
      } else {
        // Defensive: legacy / orphan path — despawn directly.
        os.removeAgent(id);
        drainQueue(os);
      }
      break;
    }
    case 'tool_started': {
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) return;
      os.setAgentActive(id, true);
      os.setAgentTool(id, evt.tool);
      break;
    }
    case 'tool_finished': {
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) return;
      os.setAgentTool(id, null);
      break;
    }
    case 'waiting_input': {
      const id = evt.session_id ? sessionToId.get(evt.session_id) : undefined;
      if (id === undefined) return;
      os.showPermissionBubble(id);
      break;
    }
    case 'token_usage': {
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) return;
      os.setAgentTokens(id, evt.input_tokens, evt.output_tokens);
      break;
    }
    case 'notification':
      // banner-level event handled at page layer — no OfficeState mutation
      break;
    case 'subagent_started': {
      const parentId = sessionToId.get(evt.parent_session_id);
      if (parentId === undefined) return;
      os.addSubagent(parentId, evt.parent_tool_id);
      break;
    }
    case 'subagent_finished': {
      const parentId = sessionToId.get(evt.parent_session_id);
      if (parentId === undefined) return;
      os.removeSubagent(parentId, evt.parent_tool_id);
      break;
    }
  }
}

// Exposed for tests so each case can start from a clean session map.
export const _internals = {
  sessionToId,
  agentToId,
  agentRefcount,
  roster,
  pendingQueue,
  reset: (): void => {
    sessionToId.clear();
    agentToId.clear();
    agentRefcount.clear();
    for (const t of lingerTimers.values()) clearTimeout(t);
    lingerTimers.clear();
    nextId = 1;
    roster.clear();
    pendingQueue.length = 0;
  },
};
