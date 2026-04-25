#!/usr/bin/env python3
"""Generate ``default-layout-3.json`` — sowork-style office redesign.

Major upgrades over layout-2:

* **Chairs face away from camera** (``CUSHIONED_CHAIR_BACK``) so each
  character's back is visible, sitting at the desk facing the PC. The
  previous layout used ``WOODEN_CHAIR_SIDE`` and characters appeared
  "sideways" relative to their workstations.
* **Real desk footprint**. ``DESK_FRONT`` is 3×2 tiles in the source
  manifest — the previous generator placed a desk per tile, double
  stacking PC + chair on the same cell. Now each workstation is the
  full 3-tile-wide desk + 1 chair tile centered in front + 1 PC
  centered on the desk's surface row.
* **Spacing**. 1 tile gap between workstations, 2 row gap between
  rows. Characters have walking space.
* **Decoration**. Each room gets bookshelves, plants in corners,
  whiteboards / paintings on the back wall — what an office actually
  looks like, not a desk warehouse.
* **Common-area in the corridor**. A ``SOFA`` cluster + ``COFFEE_TABLE``
  in the centre; plants flank the doorways.

Usage::

    uv run python scripts/generate_pixel_office_layout_v3.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "dashboard" / "backend"))

from pixel_office_departments import DEPARTMENT_AGENTS  # noqa: E402

# ── Canvas grid ────────────────────────────────────────────────────────────
COLS = 50
ROWS = 32

TILE_VOID = 255
TILE_WALL = 0
TILE_FLOOR_WARM = 1
TILE_FLOOR_COOL = 7
TILE_FLOOR_KITCHEN = 9

# Per-room HSB tile-color shifts. Subtler than v2 so the floor reads as a
# tinted wood/carpet instead of a solid colour wash.
COLOR_OPS = {"h": 142, "s": 22, "b": -18, "c": -45}
COLOR_REV = {"h": 38, "s": 26, "b": -14, "c": -45}
COLOR_STR = {"h": 270, "s": 22, "b": -22, "c": -45}
COLOR_REA = {"h": 209, "s": 30, "b": -20, "c": -65}
COLOR_EXE = {"h": 0, "s": 22, "b": -22, "c": -45}
COLOR_HALL = {"h": 209, "s": 0, "b": -10, "c": -8}
COLOR_BORDER = {"h": 214, "s": 30, "b": -100, "c": -55}

# ── Room geometry ──────────────────────────────────────────────────────────
# (id, col, row, w, h, color, floor)
ROOMS = [
    {"id": "operations",   "col": 1,  "row": 1,  "w": 15, "h": 10, "color": COLOR_OPS, "floor": TILE_FLOOR_WARM},
    {"id": "revenue",      "col": 17, "row": 1,  "w": 15, "h": 10, "color": COLOR_REV, "floor": TILE_FLOOR_WARM},
    {"id": "strategy",     "col": 33, "row": 1,  "w": 16, "h": 10, "color": COLOR_STR, "floor": TILE_FLOOR_WARM},
    {"id": "eng_reasoning", "col": 1,  "row": 13, "w": 22, "h": 18, "color": COLOR_REA, "floor": TILE_FLOOR_COOL},
    {"id": "eng_execution", "col": 24, "row": 13, "w": 25, "h": 18, "color": COLOR_EXE, "floor": TILE_FLOOR_COOL},
]
CORRIDOR_ROW = 11  # the divider strip with kitchen-style floor

# ── ID counter for furniture uids ──────────────────────────────────────────
_uid_counter = [0]


def _uid(prefix: str = "f") -> str:
    _uid_counter[0] += 1
    return f"{prefix}-{int(time.time() * 1000)}-{_uid_counter[0]:04d}"


# ── Tile + colour painting ─────────────────────────────────────────────────

def _build_tiles_and_colors() -> tuple[list[int], list[object]]:
    tiles = [[TILE_VOID] * COLS for _ in range(ROWS)]
    colors: list[list[object]] = [[None] * COLS for _ in range(ROWS)]

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

    # Corridor: kitchen-style chequer floor across the divider row.
    for c in range(1, COLS - 1):
        tiles[CORRIDOR_ROW][c] = TILE_FLOOR_KITCHEN
        colors[CORRIDOR_ROW][c] = COLOR_HALL

    # Carve doors into the corridor for each room.
    for room in ROOMS:
        c0, r0, w, h = room["col"], room["row"], room["w"], room["h"]
        door_c = c0 + w // 2
        if r0 + h - 1 == CORRIDOR_ROW - 1:
            # Top-row room — door on the south wall (its bottom row = CORRIDOR_ROW - 1)
            tiles[r0 + h - 1][door_c] = room["floor"]
            colors[r0 + h - 1][door_c] = room["color"]
        if r0 == CORRIDOR_ROW + 1:
            # Bottom-row room — door on the north wall
            tiles[r0][door_c] = room["floor"]
            colors[r0][door_c] = room["color"]

    flat_tiles = [tiles[r][c] for r in range(ROWS) for c in range(COLS)]
    flat_colors = [colors[r][c] for r in range(ROWS) for c in range(COLS)]
    return flat_tiles, flat_colors


# ── Workstation placement ─────────────────────────────────────────────────
#
# A "workstation" = one DESK_FRONT (3×2) + one PC_FRONT_OFF on the desk
# surface + one CUSHIONED_CHAIR_BACK below the desk. Footprint = 3 cols ×
# 4 rows (desk 2 rows + chair 1 row + 1 row of breathing space below).
# Workstations sit in a grid inside each room's interior.
#
# Layout per room: as many cols × rows as it takes to fit ``count`` desks
# without overflowing the room interior. Desks back-pad against the back
# wall (top of room) so chairs don't run into the south wall.

DESK_W = 3
DESK_H = 2
ROW_PITCH = DESK_H + 2   # desk(2) + chair(1) + gap(1)
COL_PITCH = DESK_W + 1   # desk(3) + gap(1)


def _grid_dims(count: int, max_per_row: int) -> tuple[int, int]:
    cols = min(count, max_per_row)
    rows = (count + max_per_row - 1) // max_per_row
    return cols, rows


def _workstation_positions(room: dict, count: int) -> list[tuple[int, int]]:
    c0, r0, w, h = room["col"], room["row"], room["w"], room["h"]
    inner_left = c0 + 2          # leave 1 wall + 1 floor margin
    inner_top = r0 + 2           # leave 1 wall + 1 floor margin (room for back-wall deco)
    inner_w = w - 4
    inner_h = h - 4
    max_per_row = max(1, (inner_w + 1) // COL_PITCH)
    grid_cols, grid_rows = _grid_dims(count, max_per_row)
    # Centre the desk grid horizontally inside the room.
    used_w = grid_cols * COL_PITCH - 1
    margin_left = max(0, (inner_w - used_w) // 2)
    positions: list[tuple[int, int]] = []
    for r_idx in range(grid_rows):
        row_count = min(max_per_row, count - r_idx * max_per_row)
        for c_idx in range(row_count):
            col = inner_left + margin_left + c_idx * COL_PITCH
            row = inner_top + r_idx * ROW_PITCH
            if row + DESK_H + 1 >= r0 + h - 1:
                break  # would overflow
            positions.append((col, row))
    return positions


def _build_furniture() -> list[dict]:
    items: list[dict] = []
    for room in ROOMS:
        agents = DEPARTMENT_AGENTS.get(room["id"], ())
        positions = _workstation_positions(room, len(agents))
        for (dcol, drow), slug in zip(positions, agents):
            # Desk anchor (top-left of 3x2).
            items.append({
                "uid": _uid(),
                "type": "DESK_FRONT",
                "col": dcol,
                "row": drow,
                "dept": room["id"],
                "agent_slug": slug,
            })
            # PC sits on the desk's front-row middle column.
            items.append({
                "uid": _uid(),
                "type": "PC_FRONT_OFF",
                "col": dcol + 1,
                "row": drow,
                "dept": room["id"],
            })
            # Chair: one tile, centred under the desk, BACK orientation so
            # the seated character faces the desk and we see them from
            # behind.
            items.append({
                "uid": _uid(),
                "type": "CUSHIONED_CHAIR_BACK",
                "col": dcol + 1,
                "row": drow + 2,
                "dept": room["id"],
                "agent_slug": slug,
            })

        # ── Decorations: corners, back wall, side walls ─────────────────
        c0, r0, w, h = room["col"], room["row"], room["w"], room["h"]
        # Corner plants (4 plants, varied)
        items.append({"uid": _uid(), "type": "LARGE_PLANT", "col": c0 + 1, "row": r0 + h - 2, "dept": room["id"]})
        items.append({"uid": _uid(), "type": "LARGE_PLANT", "col": c0 + w - 2, "row": r0 + h - 2, "dept": room["id"]})
        items.append({"uid": _uid(), "type": "PLANT", "col": c0 + 1, "row": r0 + 1, "dept": room["id"]})
        items.append({"uid": _uid(), "type": "PLANT_2", "col": c0 + w - 2, "row": r0 + 1, "dept": room["id"]})
        # Bookshelf along the back wall (top), avoiding the door-column
        bookshelf_col = c0 + w // 4
        items.append({"uid": _uid(), "type": "DOUBLE_BOOKSHELF", "col": bookshelf_col, "row": r0 + 1, "dept": room["id"]})
        # Whiteboard near the other end of the back wall
        wb_col = c0 + (3 * w) // 4
        items.append({"uid": _uid(), "type": "WHITEBOARD", "col": wb_col, "row": r0 + 1, "dept": room["id"]})

    # ── Common area in the corridor: sofa cluster + coffee table ──────────
    centre = COLS // 2
    items.append({"uid": _uid(), "type": "SOFA_FRONT", "col": centre - 2, "row": CORRIDOR_ROW, "dept": "hall"})
    items.append({"uid": _uid(), "type": "SOFA_FRONT", "col": centre + 1, "row": CORRIDOR_ROW, "dept": "hall"})
    items.append({"uid": _uid(), "type": "COFFEE_TABLE", "col": centre, "row": CORRIDOR_ROW, "dept": "hall"})
    # Plants flanking the corridor
    items.append({"uid": _uid(), "type": "HANGING_PLANT", "col": 2, "row": CORRIDOR_ROW, "dept": "hall"})
    items.append({"uid": _uid(), "type": "HANGING_PLANT", "col": COLS - 3, "row": CORRIDOR_ROW, "dept": "hall"})
    return items


def main() -> int:
    tiles, colors = _build_tiles_and_colors()
    furniture = _build_furniture()
    layout = {
        "version": 1,
        "cols": COLS,
        "rows": ROWS,
        "layoutRevision": 3,
        "tiles": tiles,
        "tileColors": colors,
        "furniture": furniture,
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
    out_path = ROOT / "dashboard" / "frontend" / "public" / "pixel-office" / "default-layout-3.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(layout, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"  grid: {COLS}x{ROWS} ({COLS * ROWS} tiles)")
    print(f"  rooms: {len(ROOMS)}")
    print(f"  furniture items: {len(furniture)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
