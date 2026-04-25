/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
import { describe, it, expect, vi } from 'vitest';
import { loadAllAssets } from './orchestrator';

describe('orchestrator', () => {
  it('fetches index.json then default layout when skipDecode=true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          characters: ['char_0.png'],
          floors: ['floor_0.png'],
          walls: ['wall_0.png'],
          furniture: ['DESK'],
          defaultLayout: 'default-layout-1.json',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            version: 1,
            cols: 5,
            rows: 5,
            tiles: [],
            tileColors: [],
            furniture: [],
          }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadAllAssets({ skipDecode: true });
    expect(result.indexLoaded).toBe(true);
    expect(result.furnitureCount).toBe(1);
    expect(result.layout).toBeDefined();
  });
});
