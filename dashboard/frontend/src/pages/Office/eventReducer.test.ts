import { describe, it, expect, beforeEach } from 'vitest';
import { OfficeState } from '../../pixel-office/engine/officeState.js';
import { applyEvent, _internals } from './eventReducer.js';

const sess = (id: string) => ({ session_id: id, ts: '2026-04-24T10:00:00Z' });

describe('applyEvent', () => {
  beforeEach(() => {
    _internals.reset();
  });

  it('spawns a character on agent_started', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'apex-architect', ...sess('s1') });
    expect(os.characters.size).toBe(1);
  });

  it('marks agent active on tool_started', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    applyEvent(os, { type: 'tool_started', agent: 'a', tool: 'Read', ...sess('s1') });
    const id = Array.from(os.characters.keys())[0];
    expect(os.characters.get(id)?.isActive).toBe(true);
  });

  it('shows permission bubble on waiting_input', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    applyEvent(os, { type: 'waiting_input', agent: 'a', ...sess('s1') });
    const id = Array.from(os.characters.keys())[0];
    expect(os.characters.get(id)?.bubbleType).toBe('permission');
  });

  it('despawns on agent_stopped', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    applyEvent(os, { type: 'agent_stopped', agent: 'a', ...sess('s1') });
    const id = Array.from(os.characters.keys())[0];
    expect(os.characters.get(id)?.matrixEffect).toBe('despawn');
  });

  it('ignores tool_started for unknown session', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'tool_started', agent: 'a', tool: 'Read', ...sess('ghost') });
    expect(os.characters.size).toBe(0);
  });

  it('reuses the same character id across events with matching session_id', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    const first = Array.from(os.characters.keys())[0];
    applyEvent(os, { type: 'tool_started', agent: 'a', tool: 'Read', ...sess('s1') });
    const ids = Array.from(os.characters.keys());
    expect(ids).toEqual([first]);
  });

  it('spawns a sub-agent next to parent', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'apex', session_id: 'p', ts: 't' });
    applyEvent(os, { type: 'subagent_started', parent_session_id: 'p', parent_tool_id: 'T1', subagent_type: 'general-purpose', ts: 't' });
    expect(os.characters.size).toBe(2);
    applyEvent(os, { type: 'subagent_finished', parent_session_id: 'p', parent_tool_id: 'T1', ts: 't' });
    const sub = Array.from(os.characters.values()).find(c => c.isSubagent);
    expect(sub?.matrixEffect).toBe('despawn');
  });
});
