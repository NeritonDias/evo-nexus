import { describe, it, expect } from 'vitest';
import { paletteForAgent, labelColorForAgent } from './agentIdentity.js';

describe('paletteForAgent', () => {
  it('returns stable palette for same slug across calls', () => {
    expect(paletteForAgent('apex-architect')).toEqual(paletteForAgent('apex-architect'));
  });

  it('distinct slugs differ in palette or hue shift', () => {
    const a = paletteForAgent('apex-architect');
    const b = paletteForAgent('nex-sales');
    expect(a.palette !== b.palette || a.hueShift !== b.hueShift).toBe(true);
  });

  it('honours explicit frontmatter color when provided', () => {
    const r = paletteForAgent('apex-architect', { color: 'blue' });
    // 'blue' maps to palette 3 in COLOR_TO_PALETTE
    expect(r.palette).toBe(3);
    expect(r.hueShift).toBeGreaterThanOrEqual(0);
  });
});

describe('labelColorForAgent', () => {
  it('returns a hex token per known frontmatter color', () => {
    expect(labelColorForAgent('blue')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(labelColorForAgent('red')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns a fallback hex for unknown / missing color', () => {
    expect(labelColorForAgent('unknown')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(labelColorForAgent(undefined)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
