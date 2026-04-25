import type { OfficeState } from '../../pixel-office/engine/officeState.js';
import { paletteForAgent } from '../../pixel-office/agentIdentity.js';

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
  | { type: 'token_usage'; session_id: string; input_tokens: number; output_tokens: number; ts: string };

// Stable mapping session_id → character id so repeated events hit the same char.
const sessionToId = new Map<string, number>();
let nextId = 1;

function resolveId(sessionId: string): number {
  let id = sessionToId.get(sessionId);
  if (id === undefined) {
    id = nextId++;
    sessionToId.set(sessionId, id);
  }
  return id;
}

export function applyEvent(os: OfficeState, evt: PixelOfficeEvent): void {
  switch (evt.type) {
    case 'agent_started': {
      const id = resolveId(evt.session_id);
      const entry = roster.get(evt.agent);
      const { palette, hueShift } = paletteForAgent(evt.agent, { color: entry?.color });
      os.addAgent(id, palette, hueShift, undefined, false, evt.agent);
      break;
    }
    case 'agent_stopped': {
      const id = sessionToId.get(evt.session_id);
      if (id !== undefined) {
        os.removeAgent(id);
        sessionToId.delete(evt.session_id);
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
  }
}

// Exposed for tests so each case can start from a clean session map.
export const _internals = {
  sessionToId,
  roster,
  reset: (): void => {
    sessionToId.clear();
    nextId = 1;
    roster.clear();
  },
};
