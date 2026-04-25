/* Adapted from pixel-agents pngDecoder.ts (MIT © 2026 Pablo De Lucca) */
import type { SpriteData } from '../types';
import { CHAR_FRAMES_PER_ROW } from './constants';

export interface CharacterDirectionSprites {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

export function rgbaToHex([r, g, b, a]: [number, number, number, number]): string {
  if (a === 0) return '';
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

async function fetchImageData(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

function imageDataToSprite(img: ImageData, x: number, y: number, w: number, h: number): SpriteData {
  const out: string[][] = [];
  for (let row = 0; row < h; row++) {
    const r: string[] = [];
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * img.width + (x + col)) * 4;
      r.push(rgbaToHex([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]));
    }
    out.push(r);
  }
  return out;
}

/** Slice a character PNG into [down, up, right] direction strips, each containing
 *  N animation frames (walk, typing, reading) of size 16×32. */
export async function decodeCharacterPngFromUrl(url: string): Promise<CharacterDirectionSprites> {
  const img = await fetchImageData(url);
  const FRAME_W = 16;
  const FRAME_H = 32;
  const decode = (rowIdx: number, frames: number): SpriteData[] => {
    const arr: SpriteData[] = [];
    for (let i = 0; i < frames; i++) {
      arr.push(imageDataToSprite(img, i * FRAME_W, rowIdx * FRAME_H, FRAME_W, FRAME_H));
    }
    return arr;
  };
  return {
    down: decode(0, CHAR_FRAMES_PER_ROW),
    up: decode(1, CHAR_FRAMES_PER_ROW),
    right: decode(2, CHAR_FRAMES_PER_ROW),
  };
}

export async function decodeFloorPngFromUrl(url: string): Promise<SpriteData> {
  const img = await fetchImageData(url);
  return imageDataToSprite(img, 0, 0, img.width, img.height);
}

export async function decodeWallPngFromUrl(url: string): Promise<SpriteData[]> {
  // Wall PNG is a horizontal strip of bitmask variants
  const img = await fetchImageData(url);
  const frameW = img.height; // square tiles
  const frameH = img.height;
  const count = Math.floor(img.width / frameW);
  const out: SpriteData[] = [];
  for (let i = 0; i < count; i++) out.push(imageDataToSprite(img, i * frameW, 0, frameW, frameH));
  return out;
}

export async function decodeFurnitureSpritePngFromUrl(url: string, w: number, h: number): Promise<SpriteData> {
  const img = await fetchImageData(url);
  return imageDataToSprite(img, 0, 0, w, h);
}
