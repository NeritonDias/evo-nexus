/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
import { describe, it, expect } from 'vitest';
import { decodeCharacterPngFromUrl, rgbaToHex } from './browserDecoder';

describe('browserDecoder', () => {
  it('rgbaToHex converts a fully opaque pixel', () => {
    expect(rgbaToHex([255, 0, 0, 255])).toBe('#ff0000');
  });
  it('rgbaToHex returns empty string for fully transparent', () => {
    expect(rgbaToHex([255, 0, 0, 0])).toBe('');
  });
  it('decodes char_0.png into walking/typing/reading frames', async () => {
    const sprites = await decodeCharacterPngFromUrl('/pixel-office/characters/char_0.png');
    expect(sprites.down.length).toBeGreaterThanOrEqual(7); // walk×3 + typing×2 + reading×2
    expect(sprites.up.length).toBeGreaterThanOrEqual(7);
    expect(sprites.right.length).toBeGreaterThanOrEqual(7);
  });
});
