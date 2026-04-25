/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
import { MAX_DELTA_TIME_SEC } from '../constants.js';

/** @internal */
export interface GameLoopCallbacks {
  update: (dt: number) => void;
  render: (ctx: CanvasRenderingContext2D) => void;
}

/** Frame interval (ms) when the tab is hidden — throttle to ~4fps to spare CPU. */
const HIDDEN_FRAME_INTERVAL_MS = 250;

export function startGameLoop(canvas: HTMLCanvasElement, callbacks: GameLoopCallbacks): () => void {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  let lastTime = 0;
  let rafId = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const cancelPending = (): void => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const tick = (time: number): void => {
    if (stopped) return;
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC);
    lastTime = time;

    callbacks.update(dt);

    ctx.imageSmoothingEnabled = false;
    callbacks.render(ctx);

    schedule();
  };

  const schedule = (): void => {
    if (stopped) return;
    // When the tab is hidden, requestAnimationFrame is throttled (or paused) by
    // most browsers. Switch to a setTimeout-based 4fps loop so we still tick
    // background state (despawn timers, etc.) without burning CPU at 60fps.
    if (typeof document !== 'undefined' && document.hidden) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        tick(performance.now());
      }, HIDDEN_FRAME_INTERVAL_MS);
    } else {
      rafId = requestAnimationFrame(tick);
    }
  };

  const onVisibilityChange = (): void => {
    if (stopped) return;
    // Reset lastTime so the dt after wake doesn't snap to a huge value.
    lastTime = 0;
    cancelPending();
    schedule();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  schedule();

  return () => {
    stopped = true;
    cancelPending();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}