---
name: dev-skillify
description: Convert the current conversation into a reusable skill. Different from skill-creator (which creates from scratch) — skillify captures what just happened and templatizes it.
---

# Dev Skillify

Derived from oh-my-claudecode (MIT, Yeachan Heo). Adapted for the EvoNexus Engineering Layer.

Convert the current conversation into a reusable skill. Unlike `skill-creator` (which builds a skill from a description), `skillify` captures the actual workflow that just happened and templatizes it.

## Use When
- You just completed a complex multi-step task that you'll want to repeat
- You want to formalize an ad-hoc workflow before it's lost
- Post-task: "I want to be able to do this again with one command"

## Do Not Use When
- The task is one-off — won't be repeated
- The task is too project-specific — won't generalize
- A skill for this already exists → use it instead
- You haven't actually completed the task yet — `dev-skillify` is retrospective

## Workflow

### Phase 1 — Capture
- Scroll through the conversation
- Identify the actual sequence of actions taken
- Note which agents were invoked and in what order
- Note what inputs were given and what outputs were produced

### Phase 2 — Generalize
- Replace specific values with placeholders (e.g., `{component}`, `{date}`)
- Identify the trigger phrases that should activate this skill
- Identify which steps were necessary vs incidental

### Phase 3 — Structure
Format as a skill:
```markdown
---
name: {prefix}-{action}
description: {one-line — when to use}
---

# {Skill Name}

## Use When
[trigger conditions]

## Workflow
1. {step}
2. {step}
...

## Output
[expected artifact]

## Pairs With
[agents/skills]
```

### Phase 4 — Save & Register
- Save to `.claude/skills/{prefix}-{action}/SKILL.md`
- Update `.claude/rules/skills.md` with the new entry
- Test by re-invoking it

## Output

```markdown
## Skillify Report

### Captured Workflow
[summary of what happened]

### Generalized Steps
[the workflow with placeholders]

### Proposed Skill
- **Name:** `{prefix}-{action}`
- **Path:** `.claude/skills/{prefix}-{action}/SKILL.md`
- **Triggers:** [list]
- **Pairs with:** [agents]

### Status
- ✅ Skill created
- ✅ rules/skills.md updated
- ✅ Tested by re-invocation
```

## Pairs With
- `skill-creator` (builtin) — for from-scratch skill creation
- `dev-learner` — for batch pattern extraction across multiple sessions
- `create-agent` (builtin) — if a new agent is needed instead

## Anti-patterns
- Skillifying one-off tasks
- Capturing too much detail (skills should be general)
- Capturing too little (skills should be actionable)
- Skipping the test phase
