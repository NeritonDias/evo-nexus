/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca
 *
 * Slimmed for evo-nexus: drops VSCode bridge (vscode.postMessage), per-agent
 * tool history, sub-agent overlays, and the close button. Renders an
 * always-on activity badge above each active character driven directly off
 * OfficeState (currentTool, bubbleType, isActive, folderName, tokens).
 */
import { useEffect, useState } from 'react';

import {
  CHARACTER_SITTING_OFFSET_PX,
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  FUEL_GAUGE_BG,
  FUEL_GAUGE_HEIGHT_PX,
  FUEL_GAUGE_WIDTH_PX,
  MAX_CONTEXT_TOKENS,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  zoom: number;
  panRef: React.MutableRefObject<{ x: number; y: number }> | React.RefObject<{ x: number; y: number }>;
}

function getFuelColor(ratio: number): string {
  if (ratio >= TOKEN_CRITICAL_THRESHOLD) return FUEL_COLOR_CRITICAL;
  if (ratio >= TOKEN_DANGER_THRESHOLD) return FUEL_COLOR_DANGER;
  if (ratio >= TOKEN_WARN_THRESHOLD) return FUEL_COLOR_WARN;
  return FUEL_COLOR_OK;
}

/** Label derived from the character's current tool / waiting state. */
function activityFor(ch: {
  currentTool: string | null;
  isActive: boolean;
  bubbleType: 'permission' | 'waiting' | null;
}): string | null {
  if (ch.bubbleType === 'permission') return 'Needs approval';
  if (ch.currentTool) return ch.currentTool;
  if (ch.isActive) return 'Thinking…';
  return null;
}

export function ToolOverlay({ officeState, zoom, panRef }: ToolOverlayProps) {
  // Re-render at ~60fps so the overlay tracks character motion.
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => (n + 1) % 1_000_000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Match the canvas world→screen transform used in OfficeCanvasLite.
  if (typeof window === 'undefined') return null;
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const items: Array<{
    id: number;
    left: number;
    top: number;
    activity: string;
    dotColor: string | null;
    isPulse: boolean;
    folderName: string | undefined;
    tokenRatio: number;
    showFuel: boolean;
  }> = [];

  for (const ch of officeState.characters.values()) {
    if (ch.matrixEffect === 'despawn') continue;
    const activity = activityFor(ch);
    if (!activity) continue;

    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
    const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
    const screenY =
      (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

    const hasPermission = ch.bubbleType === 'permission';
    const dotColor = hasPermission
      ? '#f59e0b'
      : ch.isActive
        ? '#22c55e'
        : null;

    const totalTokens = (ch.inputTokens || 0) + (ch.outputTokens || 0);
    const tokenRatio = totalTokens / MAX_CONTEXT_TOKENS;

    items.push({
      id: ch.id,
      left: screenX,
      top: screenY - 34,
      activity,
      dotColor,
      isPulse: ch.isActive && !hasPermission,
      folderName: ch.folderName,
      tokenRatio,
      showFuel: totalTokens > 0,
    });
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      {items.map((it) => (
        <div
          key={it.id}
          className="absolute flex flex-col items-center -translate-x-1/2"
          style={{
            left: it.left,
            top: it.top,
            pointerEvents: 'none',
            zIndex: 41,
          }}
        >
          <div
            className="flex items-center gap-1 px-2 py-1 rounded whitespace-nowrap"
            style={{
              background: 'rgba(12, 17, 29, 0.85)',
              border: '1px solid rgba(148, 163, 184, 0.35)',
              color: '#e2e8f0',
              fontFamily: 'ui-monospace, "Courier New", monospace',
              fontSize: 11,
              lineHeight: 1.2,
            }}
          >
            {it.dotColor && (
              <span
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                  it.isPulse ? 'animate-pulse' : ''
                }`}
                style={{ background: it.dotColor }}
              />
            )}
            <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {it.activity}
            </span>
          </div>
          {it.showFuel && (
            <div
              style={{
                width: FUEL_GAUGE_WIDTH_PX,
                height: FUEL_GAUGE_HEIGHT_PX,
                background: FUEL_GAUGE_BG,
                marginTop: 2,
              }}
              title={`${Math.round(it.tokenRatio * 100)}% context used`}
            >
              <div
                style={{
                  width: `${Math.min(it.tokenRatio * 100, 100)}%`,
                  height: '100%',
                  background: getFuelColor(it.tokenRatio),
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
