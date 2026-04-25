/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
import { describe, it, expect } from 'vitest';
import indexJson from '../../../public/pixel-office/index.json';

describe('pixel-office asset index', () => {
  it('lists at least 6 character palettes', () => {
    expect(indexJson.characters.length).toBeGreaterThanOrEqual(6);
  });
  it('lists at least 8 floor variants', () => {
    expect(indexJson.floors.length).toBeGreaterThanOrEqual(8);
  });
  it('lists at least 20 furniture types', () => {
    expect(indexJson.furniture.length).toBeGreaterThanOrEqual(20);
  });
  it('has a default layout', () => {
    expect(indexJson.defaultLayout).toMatch(/^default-layout-\d+\.json$/);
  });
});
