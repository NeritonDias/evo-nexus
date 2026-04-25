/* Deterministic visual identity for evo-nexus agents.
   Slug → {palette, hueShift}: stable across reloads, distinct per agent. */

const BASE_PALETTES = 6; // matches characters.png column count
const HUE_STEPS = [0, 45, 90, 135, 180, 225, 270, 315];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const COLOR_TO_PALETTE: Record<string, number> = {
  red: 0,
  orange: 1,
  yellow: 1,
  green: 2,
  teal: 2,
  blue: 3,
  cyan: 3,
  purple: 4,
  pink: 4,
  slate: 5,
  gray: 5,
};

const COLOR_TO_HEX: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  teal: '#14b8a6',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  purple: '#a855f7',
  pink: '#ec4899',
  slate: '#64748b',
  gray: '#9ca3af',
};

export function paletteForAgent(
  slug: string,
  frontmatter?: { color?: string },
): { palette: number; hueShift: number } {
  const h = djb2(slug);
  const fmColor = frontmatter?.color?.toLowerCase();
  const basePalette =
    fmColor && COLOR_TO_PALETTE[fmColor] !== undefined
      ? COLOR_TO_PALETTE[fmColor]
      : h % BASE_PALETTES;
  const hueShift = HUE_STEPS[(h >> 3) % HUE_STEPS.length];
  return { palette: basePalette, hueShift };
}

export function labelColorForAgent(color?: string): string {
  if (!color) return '#cbd5e1';
  return COLOR_TO_HEX[color.toLowerCase()] ?? '#cbd5e1';
}
