/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
import { useCallback, useEffect, useRef } from 'react';

import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  PAN_MARGIN_FRACTION,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from '../constants.js';
import { startGameLoop } from '../engine/gameLoop.js';
import type { OfficeState } from '../engine/officeState.js';
import type { SelectionRenderState } from '../engine/renderer.js';
import { renderFrame } from '../engine/renderer.js';
import { TILE_SIZE } from '../types.js';

interface Props {
  officeState: OfficeState;
  onSelect: (agentId: number | null) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  /** When true, every character renders its agent slug above its head. Default: true. */
  alwaysShowLabels?: boolean;
}

export function OfficeCanvasLite({
  officeState,
  onSelect,
  zoom,
  onZoomChange,
  panRef,
  alwaysShowLabels = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const zoomAccumulatorRef = useRef(0);

  const clampPan = useCallback(
    (px: number, py: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: px, y: py };
      const layout = officeState.getLayout();
      const mapW = layout.cols * TILE_SIZE * zoom;
      const mapH = layout.rows * TILE_SIZE * zoom;
      const marginX = canvas.width * PAN_MARGIN_FRACTION;
      const marginY = canvas.height * PAN_MARGIN_FRACTION;
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    },
    [officeState, zoom],
  );

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resizeCanvas();
    const observer = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) observer.observe(containerRef.current);

    const stop = startGameLoop(canvas, {
      update: (dt) => officeState.update(dt),
      render: (ctx) => {
        const w = canvas.width;
        const h = canvas.height;

        if (officeState.cameraFollowId !== null) {
          const followCh = officeState.characters.get(officeState.cameraFollowId);
          if (followCh) {
            const layout = officeState.getLayout();
            const mapW = layout.cols * TILE_SIZE * zoom;
            const mapH = layout.rows * TILE_SIZE * zoom;
            const targetX = mapW / 2 - followCh.x * zoom;
            const targetY = mapH / 2 - followCh.y * zoom;
            const dx = targetX - panRef.current.x;
            const dy = targetY - panRef.current.y;
            if (Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD && Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD) {
              panRef.current = { x: targetX, y: targetY };
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              };
            }
          }
        }

        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        };

        const { offsetX, offsetY } = renderFrame(
          ctx, w, h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          undefined,
          officeState.getLayout().tileColors,
          officeState.getLayout().cols,
          officeState.getLayout().rows,
          alwaysShowLabels,
        );
        offsetRef.current = { x: offsetX, y: offsetY };
      },
    });

    return () => { stop(); observer.disconnect(); };
  }, [officeState, resizeCanvas, zoom, panRef, alwaysShowLabels]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const deviceX = (clientX - rect.left) * dpr;
      const deviceY = (clientY - rect.top) * dpr;
      return {
        worldX: (deviceX - offsetRef.current.x) / zoom,
        worldY: (deviceY - offsetRef.current.y) / zoom,
      };
    },
    [zoom],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hit = officeState.getCharacterAt(pos.worldX, pos.worldY);
      if (hit !== null) {
        officeState.dismissBubble(hit);
        if (officeState.selectedAgentId === hit) {
          officeState.selectedAgentId = null;
          officeState.cameraFollowId = null;
          onSelect(null);
        } else {
          officeState.selectedAgentId = hit;
          officeState.cameraFollowId = hit;
          onSelect(hit);
        }
      } else if (officeState.selectedAgentId !== null) {
        officeState.selectedAgentId = null;
        officeState.cameraFollowId = null;
        onSelect(null);
      }
    },
    [officeState, onSelect, screenToWorld],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    officeState.cameraFollowId = null;
    isPanningRef.current = true;
    panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
  }, [officeState, panRef]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
    const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
    panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
  }, [panRef, clampPan]);

  const handleMouseUp = useCallback(() => { isPanningRef.current = false; }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAccumulatorRef.current += e.deltaY;
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const delta = zoomAccumulatorRef.current < 0 ? 1 : -1;
          zoomAccumulatorRef.current = 0;
          const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
          if (z !== zoom) onZoomChange(z);
        }
      } else {
        const dpr = window.devicePixelRatio || 1;
        officeState.cameraFollowId = null;
        panRef.current = clampPan(panRef.current.x - e.deltaX * dpr, panRef.current.y - e.deltaY * dpr);
      }
    },
    [zoom, onZoomChange, officeState, panRef, clampPan],
  );

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-slate-900">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="block"
      />
    </div>
  );
}
