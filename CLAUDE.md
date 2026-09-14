# Claude Code Routing Adapter

ADAPTER_CLASS: DERIVED_AGENT_ROUTING
SEMANTIC_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE

@AGENTS.md

`AGENTS.md` is the mandatory repository entrypoint and sole repository agent-law owner. Claude Code imports it directly through this adapter; project `SessionStart`, `PreToolUse`, and `SubagentStart` hooks route mechanically decidable execution gates through the repository-owned Agent Execution Guard.

This file adds no Product, architecture, execution, branch, deletion, migration, verification or closure law. If it ever conflicts with `AGENTS.md` or a canonical owner routed by `AGENTS.md`, this adapter is stale and must be corrected or deleted.
