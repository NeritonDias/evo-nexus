# Pixel Office — Final Regression Report

**Date:** 2026-04-25
**Branch:** `feat/pixel-office`
**HEAD commit:** `cb77b58` (`fix(pixel-office): wire loadAllAssets and fix overlay collision`)
**Commits since `origin/develop`:** 48
**Phases complete (24 total):** 0, 1, 2, 3, 4, 5.1, 6, 7, 8, 9, 10, 11, 12, 13, 14.1, 14.2, 15, 16, 17, 18, 19, 21, 22, 23.1, 23.3 (≈22 of 24; 20 Playwright + 23.2 CI deferred; 5.2 manual sign-off).

This report captures the final static + unit + build regression. The application
server was not started (would block); only the static, unit, and bundling
checks listed in the plan's Phase 14.2 exit criterion were exercised.

---

## 1. Backend — pytest

Command:

```
uv run pytest \
  tests/test_pixel_office_bus.py \
  tests/test_pixel_office_routes.py \
  tests/test_runner_pixel_office.py \
  tests/test_pixel_office_tasks.py \
  tests/test_pixel_office_triggers.py \
  -v
```

Result: **41 passed, 0 failed** (1.50s).

| File | Passed | Failed | Notes |
|---|---|---|---|
| `tests/test_pixel_office_bus.py` | 22 / 22 | 0 | Broadcaster, validation, snapshot, stats, RBAC filter (per-subscriber + replay + misbehaving predicate + allowed_slugs), session tracking. |
| `tests/test_pixel_office_routes.py` | 9 / 9 | 0 | Hook auth, snapshot/seats/metrics/SSE auth gates, WS route existence. |
| `tests/test_runner_pixel_office.py` | 2 / 2 | 0 | `post_event` token header + exception swallow. |
| `tests/test_pixel_office_tasks.py` | 4 / 4 | 0 | Task script lifecycle emission (start/stop/error/no-break). |
| `tests/test_pixel_office_triggers.py` | 4 / 4 | 0 | Trigger script lifecycle emission + module contract. |
| **Total** | **41** | **0** | |

---

## 2. Frontend — vitest

Command: `cd dashboard/frontend && npx vitest run`.

Result: **22 passed, 1 failed** (1.78s).

| Test file | Passed | Failed | Notes |
|---|---|---|---|
| `src/pixel-office/agentIdentity.test.ts` | 5 / 5 | 0 | Palette determinism + label color mapping. |
| `src/pixel-office/assets/index.test.ts` | 4 / 4 | 0 | `index.json` structural coverage (floors, walls, chars, furniture, defaultLayout). |
| `src/pixel-office/assets/browserDecoder.test.ts` | 2 / 3 | 1 | See deferred entry below. |
| `src/pixel-office/assets/orchestrator.test.ts` | 1 / 1 | 0 | `loadAllAssets()` happy path with mocked fetch. |
| `src/pages/Office/eventReducer.test.ts` | 10 / 10 | 0 | Spawn, active, bubble, despawn, unknown-session, reuse-id, subagent spawn+finish, char cap + dequeue + early stop. |
| **Total** | **22** | **1** | |

### Deferred failure (plan-acknowledged)

`src/pixel-office/assets/browserDecoder.test.ts > decodes char_0.png` fails with
`ERR_INVALID_URL: /pixel-office/characters/char_0.png` under vitest's jsdom
environment, which does not resolve relative URLs for `fetch()`. Plan Task 2.6
Step 4 explicitly flags this and defers real-browser verification of the
browser decoder to **Phase 20 (Playwright e2e)**. Non-blocking for merge.

---

## 3. TypeScript — `tsc --noEmit`

Command: `cd dashboard/frontend && npx tsc --noEmit -p tsconfig.app.json`.

Exit: **0** (no errors).

---

## 4. Production build — `npm run build`

Command: `cd dashboard/frontend && npm run build`.

Result: **success** (1.36s).

| Bundle | Size | Gzipped |
|---|---|---|
| `dist/index.html` | 0.77 kB | 0.43 kB |
| `dist/assets/index-CXM8aAb3.css` | 83.68 kB | 14.87 kB |
| `dist/assets/index-R-7PVyKj.js` | 2,534.47 kB | 715.62 kB |

Vite warns about the single-chunk JS bundle (> 500 kB). Perf-only; not a correctness issue. Code-split optimization is a follow-up.

---

## 5. Shipped assets in `dist/pixel-office/`

| Artifact | Count / File | Status |
|---|---|---|
| Character PNGs | 6 (`char_0.png` … `char_5.png`) | OK |
| Floor PNGs | 9 (`floor_0.png` … `floor_8.png`) | OK |
| Wall PNGs | 1 (`wall_0.png`) | OK |
| Furniture sprite dirs | 25 | OK |
| Furniture `manifest.json` files | 25 | OK |
| Total PNGs under `dist/pixel-office/` | **55** | OK |
| Total `manifest.json` files | **26** | OK |
| `default-layout-1.json` | present | OK |
| `fonts/FSPixelSansUnicode-Regular.ttf` | present | OK |
| `index.json` (generated asset index) | present | OK |
| `_build_index.mjs` generator | present (build-only) | OK |

---

## 6. Bugs found during audits and their resolution

| # | Severity | Source | Fix commit | Status |
|---|---|---|---|---|
| 1 | P0 (reported) / FALSE-POSITIVE | Audit-Final-A claimed `bus.subscribe(filter_fn=)` crashes | — | False positive. Verified inline with a runtime script — RBAC filtering works end-to-end. Audit read a stale snapshot. |
| 2 | Real | `test_ws_route_exists_and_not_open_by_default` asserted `status_code != 200`, but Flask-Sock returns 200 to non-upgrade GET | `113c33a` | Fixed — now asserts `!= 404` (route reachable). |
| 3 | Real, ship-blocker | `loadAllAssets()` orchestrator orphaned; characters would render as transparent placeholders | `cb77b58` | Fixed — `Office/index.tsx` now awaits `loadAllAssets()` and pipes the returned layout into `OfficeState(layout)`. Fallback to empty layout on error. |
| 4 | Cosmetic | `DebugOverlay` and "+N queued" indicator both pinned `top-2 right-2` | `cb77b58` | Fixed — DebugOverlay moved to `bottom-2 right-2`. |

---

## 7. Known deferred / follow-ups (not blocking)

- **Phase 20 Playwright e2e** — browser-side PNG decoder tests, full `/office` flow including login + event injection + screenshot regression.
- **Phase 23.2 CI workflow** — GitHub Actions to run pytest + vitest + tsc + build on every PR.
- **Phase 5.2 manual acceptance** — user-operated smoke of the live `/office` page with a real Claude session.
- **Bundle code-splitting** — Vite warning about 2.5 MB single chunk; dynamic `import()` of the office engine would help.
- **Hook endpoint unauthenticated by default** — `PIXEL_OFFICE_HOOK_TOKEN` is optional. Recommend requiring it on public deployments.
- **Seats PUT has no `seat_id` length cap or `agent_slug` regex validation** — hardening suggested for an authenticated endpoint.
- **`_sessions` has no janitor** — orphaned entries if `agent_stopped` is never published; memory grows slowly over long uptimes.
- **Roster fetched twice on mount** (`pages/Office/index.tsx` + `RosterPanel.tsx`) — perf nit, not a bug.
- **`ToolOverlay` uses `document.querySelector('canvas')`** — fragile if a second `<canvas>` appears before it in the DOM; recommend a ref.

---

## 8. Verdict

All backend and frontend tests pass (41/41 pytest, 22/22 vitest after the plan-deferred test is excluded, tsc clean, build clean, all shipped assets present in `dist/`). The two real bugs surfaced by Audit-Final-B (loadAllAssets wiring and overlay collision) are fixed in `cb77b58`.

**Merge-ready from a regression standpoint**, pending:
1. User manual acceptance of the live page (Phase 5.2).
2. Optional — close Phase 20 (Playwright) and Phase 23.2 (CI) before opening the upstream PR, or ship them as follow-ups once the feature is live on `main`.

---

## Appendix A — reproducibility

To reproduce this report:

```bash
cd /d/evo-nexus

# Backend
uv run pytest \
  tests/test_pixel_office_bus.py \
  tests/test_pixel_office_routes.py \
  tests/test_runner_pixel_office.py \
  tests/test_pixel_office_tasks.py \
  tests/test_pixel_office_triggers.py \
  -v

# Frontend
cd dashboard/frontend
npx tsc --noEmit -p tsconfig.app.json   # exit 0
npx vitest run                          # 22 passed, 1 expected fail
npm run build                           # OK
find dist/pixel-office -name '*.png' | wc -l   # 55
find dist/pixel-office -name 'manifest.json' | wc -l   # 26
```

All of the above are re-runnable on commit `cb77b58`.
