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
  const id = resolveId(sessionId);
  const entry = roster.get(agent);
  const { palette, hueShift } = paletteForAgent(agent, { color: entry?.color });
  os.addAgent(id, palette, hueShift, undefined, false, agent);
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
      // If the agent never spawned (still queued), just drop it from the queue.
      const queuedIdx = pendingQueue.findIndex((q) => q.session_id === evt.session_id);
      if (queuedIdx !== -1) {
        pendingQueue.splice(queuedIdx, 1);
        break;
      }
      const id = sessionToId.get(evt.session_id);
      if (id !== undefined) {
        os.removeAgent(id);
        sessionToId.delete(evt.session_id);
      }
      // A slot may now be free — drain the queue.
      drainQueue(os);
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
  roster,
  pendingQueue,
  reset: (): void => {
    sessionToId.clear();
    nextId = 1;
    roster.clear();
    pendingQueue.length = 0;
  },
};
