/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
/**
 * Asset orchestrator — runtime equivalent of the build-time pipeline.
 *
 * Two-phase load:
 *   1. Fetch index.json + default-layout.json in parallel.
 *   2. For each character/floor/wall PNG, decode in parallel via OffscreenCanvas
 *      and call setCharacterTemplates/setFloorSprites/setWallSprites.
 *   3. For each furniture folder, fetch manifest, flatten, decode each sprite,
 *      then call buildDynamicCatalog with the assembled LoadedAssetData.
 */

import { setFloorSprites } from '../floorTiles.js';
import {
  buildDynamicCatalog,
  type LoadedAssetData,
} from '../layout/furnitureCatalog.js';
import { deserializeLayout } from '../layout/layoutSerializer.js';
import { setCharacterTemplates } from '../sprites/spriteData.js';
import type { OfficeLayout, SpriteData } from '../types.js';
import { setWallSprites } from '../wallTiles.js';
import {
  decodeCharacterPngFromUrl,
  decodeFloorPngFromUrl,
  decodeFurnitureSpritePngFromUrl,
  decodeWallPngFromUrl,
} from './browserDecoder.js';
import {
  type FurnitureAsset,
  type FurnitureManifest,
  flattenManifest,
  type ManifestNode,
} from './manifestUtils.js';

const ASSET_ROOT = '/pixel-office';

export interface AssetIndex {
  characters: string[];
  floors: string[];
  walls: string[];
  furniture: string[];
  defaultLayout: string | null;
}

export interface LoadResult {
  indexLoaded: boolean;
  furnitureCount: number;
  layout: OfficeLayout | null;
}

interface LoadOptions {
  /** Skip the actual PNG decode step (useful for tests with mocked fetch) */
  skipDecode?: boolean;
  /** Override the asset root (defaults to /pixel-office) */
  assetRoot?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return (await res.json()) as T;
}

function flattenFurnitureManifest(manifest: FurnitureManifest): FurnitureAsset[] {
  // Build a synthetic root group node so flattenManifest can recurse uniformly.
  const inherited = {
    groupId: manifest.id,
    name: manifest.name,
    category: manifest.category,
    canPlaceOnWalls: manifest.canPlaceOnWalls,
    canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
    backgroundTiles: manifest.backgroundTiles,
  };
  if (manifest.type === 'asset') {
    const asAsset: ManifestNode = {
      type: 'asset',
      id: manifest.id,
      file: manifest.file ?? '',
      width: manifest.width ?? 0,
      height: manifest.height ?? 0,
      footprintW: manifest.footprintW ?? 1,
      footprintH: manifest.footprintH ?? 1,
    };
    return flattenManifest(asAsset, inherited);
  }
  // Group manifest — recurse into members
  const members = manifest.members ?? [];
  const results: FurnitureAsset[] = [];
  for (const m of members) {
    results.push(...flattenManifest(m, inherited));
  }
  return results;
}

/**
 * Public entry point. Loads asset index, default layout, and (unless skipDecode)
 * decodes every PNG into the engine's in-memory sprite stores.
 */
export async function loadAllAssets(opts: LoadOptions = {}): Promise<LoadResult> {
  const root = opts.assetRoot ?? ASSET_ROOT;

  // Phase 1 — index + layout in parallel
  const index = await fetchJson<AssetIndex>(`${root}/index.json`);
  let layout: OfficeLayout | null = null;
  if (index.defaultLayout) {
    try {
      const layoutText = await (await fetch(`${root}/${index.defaultLayout}`)).text();
      layout = deserializeLayout(layoutText);
    } catch (err) {
      console.warn('Failed to load default layout:', err);
    }
  }

  if (opts.skipDecode) {
    return {
      indexLoaded: true,
      furnitureCount: index.furniture.length,
      layout,
    };
  }

  // Phase 2 — decode characters / floors / walls in parallel
  const charPromises = index.characters.map((f) =>
    decodeCharacterPngFromUrl(`${root}/characters/${f}`),
  );
  const floorPromises = index.floors.map((f) => decodeFloorPngFromUrl(`${root}/floors/${f}`));
  const wallPromises = index.walls.map((f) => decodeWallPngFromUrl(`${root}/walls/${f}`));

  const [chars, floors, wallSets] = await Promise.all([
    Promise.all(charPromises),
    Promise.all(floorPromises),
    Promise.all(wallPromises),
  ]);

  setCharacterTemplates(chars);
  setFloorSprites(floors);
  // wallSets is SpriteData[][] — one entry per wall PNG, each containing N bitmask variants
  setWallSprites(wallSets);

  // Phase 3 — furniture: fetch manifests, decode sprites, build catalog
  const furnitureAssets: FurnitureAsset[] = [];
  const furnitureSprites: Record<string, SpriteData> = {};

  await Promise.all(
    index.furniture.map(async (folder) => {
      try {
        const manifest = await fetchJson<FurnitureManifest>(
          `${root}/furniture/${folder}/manifest.json`,
        );
        const assets = flattenFurnitureManifest(manifest);
        furnitureAssets.push(...assets);

        // Decode each unique file referenced by these assets
        const uniqueFiles = new Map<string, FurnitureAsset>();
        for (const a of assets) {
          if (!uniqueFiles.has(a.file)) uniqueFiles.set(a.file, a);
        }
        await Promise.all(
          Array.from(uniqueFiles.values()).map(async (a) => {
            try {
              const sprite = await decodeFurnitureSpritePngFromUrl(
                `${root}/furniture/${folder}/${a.file}`,
                a.width,
                a.height,
              );
              // Map every asset id that uses this file to the same decoded sprite
              for (const sib of assets) {
                if (sib.file === a.file) furnitureSprites[sib.id] = sprite;
              }
            } catch (err) {
              console.warn(`Failed to decode furniture sprite ${folder}/${a.file}:`, err);
            }
          }),
        );
      } catch (err) {
        console.warn(`Failed to load furniture manifest ${folder}:`, err);
      }
    }),
  );

  const loadedData: LoadedAssetData = {
    catalog: furnitureAssets.map((a) => ({
      id: a.id,
      label: a.label,
      category: a.category,
      width: a.width,
      height: a.height,
      footprintW: a.footprintW,
      footprintH: a.footprintH,
      isDesk: a.isDesk,
      groupId: a.groupId,
      orientation: a.orientation,
      state: a.state,
      canPlaceOnSurfaces: a.canPlaceOnSurfaces,
      backgroundTiles: a.backgroundTiles,
      canPlaceOnWalls: a.canPlaceOnWalls,
      mirrorSide: a.mirrorSide,
      rotationScheme: a.rotationScheme,
      animationGroup: a.animationGroup,
      frame: a.frame,
    })),
    sprites: furnitureSprites,
  };
  buildDynamicCatalog(loadedData);

  return {
    indexLoaded: true,
    furnitureCount: index.furniture.length,
    layout,
  };
}
