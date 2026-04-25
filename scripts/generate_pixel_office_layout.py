#!/usr/bin/env python3
"""Generate ``default-layout-2.json`` — a five-room department layout.

The original ``default-layout-1.json`` was a 21x22 single-room office. This
generator produces a 36x26 canvas with five clearly walled-off rooms, one
per evo-nexus department, with desks + chairs + PCs sized to seat each
department's headcount.

Usage::

    uv run python scripts/generate_pixel_office_layout.py

Writes to ``dashboard/frontend/public/pixel-office/default-layout-2.json``.
The asset orchestrator picks the highest-numbered ``default-layout-N.json``
automatically — committing this file makes it the new default. The old
``default-layout-1.json`` stays as a backup that can be selected by the UI.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# Make the dashboard backend importable so we can reuse the dept mapping.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "dashboard" / "backend"))

from pixel_office_departments import (  # noqa: E402
    ALL_DEPARTMENTS,
    DEPARTMENT_AGENTS,
)

# ── Canvas grid ────────────────────────────────────────────────────────────
COLS = 36
ROWS = 26

# Tile codes mirror the existing default-layout-1.json convention:
# 0   = wall
# 1   = floor (warm tile)
# 7   = floor (cool tile)
# 9   = floor (kitchen / common)
# 255 = void (no tile)
TILE_VOID = 255
TILE_WALL = 0
TILE_FLOOR_WARM = 1
TILE_FLOOR_COOL = 7
TILE_FLOOR_KITCHEN = 9

# HSB tile-color shifts. Each room has its own subtle floor tint so the
# departments are distinguishable at a glance even on the rendered canvas.
COLOR_OPS = {"h": 142, "s": 30, "b": -22, "c": -55}    # green-tinged
COLOR_REV = {"h": 38, "s": 35, "b": -18, "c": -55}     # amber
COLOR_STR = {"h": 270, "s": 30, "b": -28, "c": -55}    # purple
COLOR_REA = {"h": 209, "s": 39, "b": -25, "c": -80}    # blue (cool)
COLOR_EXE = {"h": 0, "s": 30, "b": -28, "c": -55}      # red-warm
COLOR_HALL = {"h": 209, "s": 0, "b": -16, "c": -8}     # neutral grey
COLOR_BORDER = {"h": 214, "s": 30, "b": -100, "c": -55}  # dark wall trim

# ── Room layout: (col_start, row_start, cols, rows, color, dept) ────────────
# Five rooms in a 2x3-ish grid plus a central corridor / common area.
ROOMS: list[dict] = [
    # Top row — 3 rooms side by side
    {"id": "operations",   "col": 1,  "row": 1,  "w": 11, "h": 9,  "color": COLOR_OPS, "floor": TILE_FLOOR_WARM},
    {"id": "revenue",      "col": 13, "row": 1,  "w": 10, "h": 9,  "color": COLOR_REV, "floor": TILE_FLOOR_WARM},
    {"id": "strategy",     "col": 24, "row": 1,  "w": 11, "h": 9,  "color": COLOR_STR, "floor": TILE_FLOOR_WARM},
    # Bottom row — 2 wide engineering rooms
    {"id": "eng_reasoning", "col": 1,  "row": 12, "w": 16, "h": 13, "color": COLOR_REA, "floor": TILE_FLOOR_COOL},
    {"id": "eng_execution", "col": 18, "row": 12, "w": 17, "h": 13, "color": COLOR_EXE, "floor": TILE_FLOOR_COOL},
]

# Central horizontal corridor between top-row rooms and bottom row.
CORRIDOR_ROW = 10
CORRIDOR_HEIGHT = 1


def _build_tiles_and_colors() -> tuple[list[int], list[object]]:
    tiles = [[TILE_VOID] * COLS for _ in range(ROWS)]
    colors: list[list[object]] = [[None] * COLS for _ in range(ROWS)]

    # Paint each room: floor + color, walls on the perimeter.
    for room in ROOMS:
        c0, r0 = room["col"], room["row"]
        w, h = room["w"], room["h"]
        floor_tile = room["floor"]
        floor_color = room["color"]
        for r in range(r0, r0 + h):
            for c in range(c0, c0 + w):
                on_edge = r in (r0, r0 + h - 1) or c in (c0, c0 + w - 1)
                if on_edge:
                    tiles[r][c] = TILE_WALL
                    colors[r][c] = COLOR_BORDER
                else:
                    tiles[r][c] = floor_tile
                    colors[r][c] = floor_color

    # Carve the central corridor with neutral grey floor.
    for c in range(1, COLS - 1):
        tiles[CORRIDOR_ROW][c] = TILE_FLOOR_KITCHEN
        colors[CORRIDOR_ROW][c] = COLOR_HALL

    # Carve doorways: one tile in the middle of each shared wall opens to the
    # corridor so characters can path between rooms.
    for room in ROOMS:
        c0, r0, w, h = room["col"], room["row"], room["w"], room["h"]
        if r0 + h - 1 == CORRIDOR_ROW - 1 or r0 + h - 1 == CORRIDOR_ROW:
            # Top-row room — break the bottom wall into the corridor.
            door_c = c0 + w // 2
            tiles[r0 + h - 1][door_c] = room["floor"]
            colors[r0 + h - 1][door_c] = room["color"]
        if r0 == CORRIDOR_ROW + 1:
            # Bottom-row room — break the top wall.
            door_c = c0 + w // 2
            tiles[r0][door_c] = room["floor"]
            colors[r0][door_c] = room["color"]

    flat_tiles = [tiles[r][c] for r in range(ROWS) for c in range(COLS)]
    flat_colors = [colors[r][c] for r in range(ROWS) for c in range(COLS)]
    return flat_tiles, flat_colors


def _desk_positions(room: dict, count: int) -> list[tuple[int, int]]:
    """Place ``count`` desks in two rows along the back of the room.

    Each desk occupies one tile (its chair sits on the row in front,
    mirrored facing right or left depending on the room half).
    """
    c0, r0, w, h = room["col"], room["row"], room["w"], room["h"]
    inner_w = w - 2  # interior width between walls
    interior_left = c0 + 1
    desk_row_a = r0 + 2  # top desk row
    desk_row_b = r0 + 5 if h >= 8 else None
    spacing = max(2, inner_w // ((count + 1) // 2 + 1))

    positions: list[tuple[int, int]] = []
    cols_per_row = (count + 1) // 2
    cols_in_second_row = count - cols_per_row

    for i in range(cols_per_row):
        positions.append((interior_left + 1 + i * spacing, desk_row_a))
    if desk_row_b is not None:
        for i in range(cols_in_second_row):
            positions.append((interior_left + 1 + i * spacing, desk_row_b))
    return positions[:count]


_uid_counter = [0]


def _uid(prefix: str = "f") -> str:
    _uid_counter[0] += 1
    return f"{prefix}-{int(time.time() * 1000)}-{_uid_counter[0]:04d}"


def _build_furniture() -> list[dict]:
    items: list[dict] = []
    for room in ROOMS:
        agents = DEPARTMENT_AGENTS.get(room["id"], ())
        positions = _desk_positions(room, len(agents))
        for (col, drow), slug in zip(positions, agents):
            # Desk faces front (chair sits below it). Use DESK_FRONT + chair on
            # the next row down. PC sits on the desk surface.
            items.append({
                "uid": _uid(),
                "type": "DESK_FRONT",
                "col": col,
                "row": drow,
                "dept": room["id"],
                "agent_slug": slug,
            })
            items.append({
                "uid": _uid(),
                "type": "PC_FRONT_OFF",
                "col": col,
                "row": drow,
                "dept": room["id"],
            })
            items.append({
                "uid": _uid(),
                "type": "WOODEN_CHAIR_SIDE",
                "col": col,
                "row": drow + 1,
                "dept": room["id"],
                "agent_slug": slug,
            })

        # Add a couple of plants for vibe.
        c0, r0, w, h = room["col"], room["row"], room["w"], room["h"]
        items.append({
            "uid": _uid(),
            "type": "PLANT",
            "col": c0 + 1,
            "row": r0 + h - 2,
            "dept": room["id"],
        })
        items.append({
            "uid": _uid(),
            "type": "PLANT",
            "col": c0 + w - 2,
            "row": r0 + h - 2,
            "dept": room["id"],
        })

    # Common-area sofa cluster in the corridor's center for visual interest.
    items.append({"uid": _uid(), "type": "SOFA_FRONT", "col": COLS // 2 - 1, "row": CORRIDOR_ROW, "dept": "hall"})
    items.append({"uid": _uid(), "type": "COFFEE_TABLE", "col": COLS // 2,     "row": CORRIDOR_ROW, "dept": "hall"})

    return items


def main() -> int:
    tiles, colors = _build_tiles_and_colors()
    furniture = _build_furniture()
    layout = {
        "version": 1,
        "cols": COLS,
        "rows": ROWS,
        "layoutRevision": 2,
        "tiles": tiles,
        "tileColors": colors,
        "furniture": furniture,
        # Department metadata so the frontend can label rooms + assign seats.
        "departments": [
            {
                "id": room["id"],
                "col": room["col"],
                "row": room["row"],
                "w": room["w"],
                "h": room["h"],
            }
            for room in ROOMS
        ],
    }
    out_path = ROOT / "dashboard" / "frontend" / "public" / "pixel-office" / "default-layout-2.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(layout, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"  tiles: {len(tiles)} ({COLS}x{ROWS})")
    print(f"  furniture items: {len(furniture)}")
    print(f"  rooms: {len(ROOMS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
