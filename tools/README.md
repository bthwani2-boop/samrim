# Repository Tooling

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_COMMAND_AUTHORITY: LIVE_PACKAGE_SCRIPTS_AND_TOOL_SOURCE

`tools/` contains cross-repository automation, inspection, generation and evidence. It is not Product or architecture authority.

## Placement

```text
SERVICE-SPECIFIC TOOL → owning service
APP-SPECIFIC TOOL     → owning app
CROSS-REPOSITORY TOOL → tools/
```

Do not add a repository-wide wrapper when a current owner or standard tool already solves the problem.

## Execution model

```text
AGENTS.md
→ exact Git state
→ affected project graph
→ claim-specific evidence
→ one final safe push
→ independent CI integration proof
```

`pnpm verify` is the exact local affected-candidate static/workspace entrypoint. It does not install dependencies and does not start/stop Docker.

`pnpm safe:push` resolves the correct branch delta, runs the canonical verifier once, pushes safely, and confirms the exact remote SHA. An already-pushed exact SHA is a no-op.

Docker runtime lifecycle remains separate:

```text
pnpm runtime:up
pnpm runtime:doctor
pnpm runtime:status
```

These three commands intentionally address the complete canonical Docker stack. Surface commands may start only their causal runtime subset and never stop unrelated running surfaces.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard:

1. prove a current material problem;
2. prove an existing mechanism cannot solve it more simply;
3. identify one lifecycle owner;
4. keep deterministic inputs/outputs;
5. add CI only for a materially distinct claim;
6. define when the mechanism can be deleted.

If the same outcome survives with less code, fewer states, fewer commands or fewer layers, use the simpler design.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`. `query-knowledge.mjs` is available for decision-relevant source inspection; do not enumerate knowledge without a material question.
