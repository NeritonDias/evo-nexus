# Agents (16 business + 19 engineering core + custom)

Defined in `.claude/agents/`. Each agent has an isolated domain and can be invoked via command. EvoNexus organizes agents in **two ortogonal layers**:

- **Business Layer** — 16 agents for operations, finance, community, marketing, HR, legal, product, data, sales.
- **Engineering Layer** — 19 agents for software development, derived from [oh-my-claudecode](https://github.com/yeachan-heo/oh-my-claudecode) (MIT). See [NOTICE.md](../../NOTICE.md).

Custom agents use `custom-` prefix and are gitignored.

---

## Business Layer (16)

| Agent | Command | Domain |
|--------|---------|---------|
| **Clawdia** | `/clawdia` | Operational hub — calendar, emails, tasks, decisions |
| **Flux** | `/flux` | Finance — cash flow, metrics, Stripe, Omie |
| **Atlas** | `/atlas` | Projects — status, milestones, blockers, Linear, GitHub, Licensing |
| **Kai** | `/kai` | Personal — health, habits, routine (isolated domain) |
| **Pulse** | `/pulse` | Community — Discord, WhatsApp, sentiment, FAQ |
| **Sage** | `/sage` | Strategy — OKRs, roadmap, prioritization, scenarios |
| **Pixel** | `/pixel` | Social media — content, calendar, analysis, reports |
| **Nex** | `/nex` | Sales — pipeline, proposals, qualification |
| **Mentor** | `/mentor` | Courses — learning paths, modules, Evo Academy |
| **Oracle** | `/oracle` | Workspace knowledge — docs, how-to, configuration |
| **Mako** | `/mako` | Marketing — campaigns, content strategy, SEO, email, brand |
| **Aria** | `/aria` | HR / People — recruiting, onboarding, performance, compensation |
| **Zara** | `/zara` | Customer Success — triage, escalation, health scores, KB |
| **Lex** | `/lex` | Legal / Compliance — contracts, NDA, LGPD, risk assessment |
| **Nova** | `/nova` | Product — specs, roadmaps, metrics, research, prioritization |
| **Dex** | `/dex` | Data / BI — analysis, SQL, dashboards, visualizations |

---

## Engineering Layer (19) — derived from oh-my-claudecode

*Imported in phases — see `workspace/projects/specs/[C]omc-integration-quick-spec.md` roadmap.*

### Reasoning (opus)
| Agent | Command | Role |
|---|---|---|
| **Apex** | `/apex` | Architect — architectural design, read-only debugging, tradeoffs |
| **Echo** | `/echo` | Analyst — discovery, requirements gaps, hidden assumptions |
| **Compass** | `/compass` | Planner — tactical 3-6 step planning with interview |
| **Raven** | `/raven` | Critic — challenges plans before execution, multi-perspective |
| **Lens** | `/lens` | Code Reviewer — 2-stage review (spec + quality), OWASP, SOLID |
| **Zen** | `/zen` | Code Simplifier — deslop, refactoring, clarity |
| **Vault** | `/vault` | Security Reviewer — OWASP Top 10, secrets, dependency audit |

### Execution (sonnet)
| Agent | Command | Role |
|---|---|---|
| **Bolt** | `/bolt` | Executor — precise multi-file implementation |
| **Hawk** | `/hawk` | Debugger — root cause, regressions, stack traces |
| **Grid** | `/grid` | Test Engineer — TDD, strategy pyramid, coverage |
| **Probe** | `/probe` | QA Tester — interactive testing, flaky diagnosis |
| **Oath** | `/oath` | Verifier — evidence-based completion verification |
| **Trail** | `/trail` | Tracer — causal tracing, competing hypotheses |
| **Flow** | `/flow` | Git Master — atomic commits, rebase, history cleanup |
| **Scroll** | `/scroll` | Document Specialist — external docs (SDKs, APIs) via web |
| **Canvas** | `/canvas` | Designer — UI/UX for product (Evo AI CRM, dashboards) |
| **Prism** | `/prism` | Scientist — formal statistical analysis, hypothesis testing |

### Speed (haiku)
| Agent | Command | Role |
|---|---|---|
| **Scout** | `/scout` | Explorer — parallel codebase search (Glob/Grep/AST) |
| **Quill** | `/quill` | Writer — quick technical docs, README, comments |

---

## Custom Agents

Users can create custom agents with `custom-` prefix:
- Files: `.claude/agents/custom-{name}.md` + `.claude/commands/custom-{name}.md`
- Memory: `.claude/agent-memory/custom-{name}/`
- All gitignored (personal to workspace)
- Use the `create-agent` skill to create one

---

## How to Use

- Use the correct agent for each domain. Do not mix responsibilities across layers when avoidable.
- **Business tasks** (emails, finance, community, etc.) → Business Layer
- **Engineering tasks** (code, tests, reviews, debug) → Engineering Layer
- Each agent has a dedicated `agent-memory/` for persistence between sessions.
- Business agents default to `sonnet`; engineering agents inherit model tier from OMC (opus / sonnet / haiku) calibrated per role.
- To invoke, use the corresponding slash command (e.g., `/clawdia`, `/apex`, `/bolt`).
- Cross-layer handoffs are allowed: e.g., `/nova` can delegate an implementation spec to `/apex` + `/bolt` + `/oath`.
