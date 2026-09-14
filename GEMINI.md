# Gemini CLI Routing Adapter

ADAPTER_CLASS: DERIVED_AGENT_ROUTING
SEMANTIC_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE

`.gemini/settings.json` loads `AGENTS.md` directly as project context. `AGENTS.md` is the mandatory repository entrypoint and sole repository agent-law owner; `SessionStart` injects session context, `BeforeAgent` establishes the execution gate before planning, and `BeforeTool` enforces mechanically decidable execution boundaries through the repository-owned Agent Execution Guard.

This file adds no Product, architecture, execution, branch, deletion, migration, verification or closure law. If it ever conflicts with `AGENTS.md` or a canonical owner routed by `AGENTS.md`, this adapter is stale and must be corrected or deleted.
