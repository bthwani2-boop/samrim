# LeanCTX Usage

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

LeanCTX is an optional context-reduction and code-navigation tool. It is not a governance source, Product Truth source, approval authority, or evidence substitute.

Canonical tool policy: `.agents/tools/leanctx.md`.
Agent adapter: `LEAN-CTX.md`.
Agent routing index: `.agents/INDEX.md`.

## Use when

Use LeanCTX when repeated reads, large search output, or context compression would materially reduce noise while preserving the exact files, symbols, evidence, blockers, and decision boundaries needed for the task.

Do not use it automatically for small/scoped work. Do not let summarization replace exact contract, migration, security, finance, or candidate-bound evidence that must be inspected directly.

## Operating rule

Follow the normal tool ladder from `AGENTS.md`: direct inspection and focused search first; LeanCTX only when context reduction is actually useful. Any conclusion produced from compressed context must still be reconciled with the authoritative repository source before a consequential write or closure claim.

## Local setup

Use the repository's current LeanCTX configuration (`.lean-ctx.toml` and `.lean-ctx-id`) and the executable/tool integration registered for the workspace. Installation or invocation details may change with the tool version; verify the installed command rather than relying on historical examples.

Never commit generated caches, credentials, private context dumps, or local machine-specific state unless a repository contract explicitly requires them.
