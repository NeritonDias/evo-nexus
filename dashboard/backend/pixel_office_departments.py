"""Static mapping of every evo-nexus agent slug to a "department" room.

The pixel office canvas renders one **room per department** with desks
clustered together. When a session spawns, the frontend looks up the
agent's department here and prefers a seat in that room instead of
falling through to a random free seat — so the office layout reflects
"exactly how the agents are divided" in `.claude/rules/agents.md`.

Departments (5 rooms, 38 agents total):

* ``operations``        — Operations + Personal + HR + CS + Legal
                          (Clawdia, Atlas, Aria, Zara, Lex, Kai)            6
* ``revenue``           — Finance + Sales + Marketing + Social + Community
                          (Flux, Nex, Mako, Pixel, Pulse)                   5
* ``strategy``          — Strategy + Product + Data + Education
                          (Sage, Oracle, Nova, Dex, Mentor, Lumen)          6
* ``eng_reasoning``     — Reasoning agents + Speed (read-heavy work)
                          (Apex, Echo, Compass, Raven, Lens, Zen, Vault,
                           Scout, Quill)                                    9
* ``eng_execution``     — Execution agents (write-heavy work)
                          (Bolt, Hawk, Grid, Probe, Oath, Trail, Flow,
                           Scroll, Canvas, Prism, Helm, Mirror)            12
                                                                         ----
                                                                          38
"""
from __future__ import annotations

from typing import Final


# Stable department ids — these become the room-key in the layout JSON.
DEPT_OPERATIONS: Final[str] = "operations"
DEPT_REVENUE: Final[str] = "revenue"
DEPT_STRATEGY: Final[str] = "strategy"
DEPT_ENG_REASONING: Final[str] = "eng_reasoning"
DEPT_ENG_EXECUTION: Final[str] = "eng_execution"

ALL_DEPARTMENTS: Final[tuple[str, ...]] = (
    DEPT_OPERATIONS,
    DEPT_REVENUE,
    DEPT_STRATEGY,
    DEPT_ENG_REASONING,
    DEPT_ENG_EXECUTION,
)

# Human-readable label used in the UI / sidebar header.
DEPARTMENT_LABELS: Final[dict[str, str]] = {
    DEPT_OPERATIONS: "Operations",
    DEPT_REVENUE: "Revenue",
    DEPT_STRATEGY: "Strategy & Product",
    DEPT_ENG_REASONING: "Engineering — Reasoning",
    DEPT_ENG_EXECUTION: "Engineering — Execution",
}

# Accent colour per department (CSS hex). Matches Tailwind palette so the
# overlay + roster sidebar can pick this up directly.
DEPARTMENT_COLORS: Final[dict[str, str]] = {
    DEPT_OPERATIONS: "#22c55e",       # green
    DEPT_REVENUE: "#f59e0b",          # amber
    DEPT_STRATEGY: "#a855f7",         # purple
    DEPT_ENG_REASONING: "#3b82f6",    # blue
    DEPT_ENG_EXECUTION: "#ef4444",    # red
}

# Authoritative slug → department mapping. Order inside each list defines a
# stable seat-assignment ordering: the Nth agent in a department gets the
# Nth seat of that department's room.
DEPARTMENT_AGENTS: Final[dict[str, tuple[str, ...]]] = {
    DEPT_OPERATIONS: (
        "clawdia-assistant",
        "atlas-project",
        "aria-hr",
        "zara-cs",
        "lex-legal",
        "kai-personal-assistant",
    ),
    DEPT_REVENUE: (
        "flux-finance",
        "nex-sales",
        "mako-marketing",
        "pixel-social-media",
        "pulse-community",
    ),
    DEPT_STRATEGY: (
        "sage-strategy",
        "oracle",
        "nova-product",
        "dex-data",
        "mentor-courses",
        "lumen-learning",
    ),
    DEPT_ENG_REASONING: (
        "apex-architect",
        "echo-analyst",
        "compass-planner",
        "raven-critic",
        "lens-reviewer",
        "zen-simplifier",
        "vault-security",
        "scout-explorer",
        "quill-writer",
    ),
    DEPT_ENG_EXECUTION: (
        "bolt-executor",
        "hawk-debugger",
        "grid-tester",
        "probe-qa",
        "oath-verifier",
        "trail-tracer",
        "flow-git",
        "scroll-docs",
        "canvas-designer",
        "prism-scientist",
        "helm-conductor",
        "mirror-retro",
    ),
}


def department_for_agent(slug: str) -> str | None:
    """Return the department id for ``slug`` or ``None`` if unmapped.

    Unmapped slugs (custom user agents, typos, future additions) fall
    through to the engine's default random seat assignment.
    """
    for dept, slugs in DEPARTMENT_AGENTS.items():
        if slug in slugs:
            return dept
    return None


def department_summary() -> list[dict[str, object]]:
    """Public API shape — used by /api/pixel-office/departments to drive the
    frontend room layout, accent colours, and roster grouping."""
    summary: list[dict[str, object]] = []
    for dept in ALL_DEPARTMENTS:
        slugs = DEPARTMENT_AGENTS[dept]
        summary.append({
            "id": dept,
            "label": DEPARTMENT_LABELS[dept],
            "color": DEPARTMENT_COLORS[dept],
            "agents": list(slugs),
            "count": len(slugs),
        })
    return summary
