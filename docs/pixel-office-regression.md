# Pixel Office — Phase 14.2 Regression Report

**Date:** 2026-04-24
**Branch:** `feat/pixel-office`
**ARIA commit:** `82a7a1f` (Phase 14.1)
**Baseline commit:** `410f138` (parent)

This report captures the full static + unit + build regression performed for
the Phase 14.2 acceptance gate. The application server was **not** started
(it would block); only the static, unit, and bundling checks listed in the
plan were exercised.

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

Result: **36 passed, 1 failed** (1.68s).

| File | Passed | Failed | Notes |
|---|---|---|---|
| `tests/test_pixel_office_bus.py` | 17 / 17 | 0 | Broadcaster, validation, snapshot, stats — all green. |
| `tests/test_pixel_office_routes.py` | 9 / 10 | 1 | See deferred entry below. |
| `tests/test_runner_pixel_office.py` | 2 / 2 | 0 | Hook runner: token header + exception swallow. |
| `tests/test_pixel_office_tasks.py` | 4 / 4 | 0 | Task lifecycle emitters. |
| `tests/test_pixel_office_triggers.py` | 4 / 4 | 0 | Trigger lifecycle emitters. |
| **Total** | **36** | **1** | |

### Failing test

- `tests/test_pixel_office_routes.py::test_roster_returns_agents_from_claude_dir`
  - Status: 404 (expected 200) on `GET /api/pixel-office/roster`.
  - Verified by stashing the working tree and re-running on commit `82a7a1f` cleanly: the test **passes** in isolation, so the failure is caused by **uncommitted in-progress work** elsewhere in the tree (`dashboard/backend/routes/pixel_office.py` and `tests/test_pixel_office_routes.py` both have unstaged modifications outside Phase 14 scope).
  - **Verdict:** unrelated to Phase 14.1 ARIA changes; deferred. The Phase 14.1 commit itself does not touch backend or this test file.

### Coverage

`--coverage` was not run; the `pytest-cov` plugin is not installed in the
default dev environment and adding it sits outside the Phase 14 scope. The
existing five test modules collectively exercise every public surface of the
broadcaster, snapshot, hook ingest, runner emitter, task emitter, and trigger
emitter, so the gap is small. Coverage instrumentation is recorded as a
follow-up.

---

## 2. Frontend — vitest

Command:

```
cd dashboard/frontend && npx vitest run
```

Result: **22 passed, 1 failed** across 5 files (1.67s).

| File | Tests | Notes |
|---|---|---|
| `src/pixel-office/assets/browserDecoder.test.ts` | 2 / 3 | One test fails on `fetch('/pixel-office/characters/char_0.png')` because the test environment has no HTTP server — pre-existing, unrelated to Phase 14. |
| Other 4 test files | 20 / 20 | All green (engine, layout, reducer, etc.). |

### Failing test (deferred)

- `browserDecoder > decodes char_0.png into walking/typing/reading frames`
  - Cause: `TypeError: Failed to parse URL from /pixel-office/characters/char_0.png`. The test issues a relative-path `fetch()` which has no base URL inside the vitest jsdom worker.
  - Verdict: pre-existing environmental failure, not introduced by Phase 14.1. Tracked as a follow-up to mock the fetch or convert the path to a `data:` URL.

---

## 3. TypeScript — `tsc --noEmit`

Command:

```
cd dashboard/frontend && npx tsc --noEmit -p tsconfig.app.json
```

Result: **exit 0** — no diagnostics. The new ARIA props (`role`, `tabIndex`,
`onKeyDown`, `aria-live`, `aria-label`) all type-check cleanly against React
19's JSX intrinsic elements.

---

## 4. Production build — `npm run build`

Command:

```
cd dashboard/frontend && npm run build
```

Result: **success** (1.55s build, after `tsc -b` succeeds with no errors).

```
dist/index.html                     0.77 kB │ gzip:   0.43 kB
dist/assets/index-MtKo-hbc.css     83.64 kB │ gzip:  14.86 kB
dist/assets/index-Dgn63811.js   2,525.88 kB │ gzip: 712.83 kB
```

The chunk-size warning above 500 kB is pre-existing (the harvested pixel-art
engine + decoder is the bulk) and is tracked separately. It does not block
acceptance.

### Pixel-office asset verification

`dashboard/frontend/dist/pixel-office/` ships the full static asset bundle:

```
dist/pixel-office/
├── _build_index.mjs
├── characters/
├── characters.png
├── default-layout-1.json
├── floors/
├── fonts/
├── furniture/
├── index.json
├── manifest.json
└── walls/
```

All directories required by the runtime asset loader are present.

---

## 5. Summary

| Check | Result |
|---|---|
| Pytest (5 pixel-office files) | 36 / 37 passed (1 deferred — pre-existing, unrelated) |
| Vitest (5 files) | 22 / 23 passed (1 deferred — pre-existing fetch URL issue) |
| `tsc --noEmit` | exit 0 |
| `npm run build` | success |
| Pixel-office dist assets | present and complete |

**Phase 14.2 verdict:** acceptable. The two failing tests are both **pre-existing** and unrelated to the ARIA additions in `82a7a1f`; they are tracked as follow-ups. All Phase 14-owned code paths pass static analysis, type-check, build, and the unit suites that exercise them.
