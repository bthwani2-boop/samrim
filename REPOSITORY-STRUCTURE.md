# BThwani — Repository Placement and Ownership

STATUS: ACTIVE_FOR_FOUNDATION_ONLY
SEMANTIC_SCOPE: file placement and migration rules; not Product, agent authorization or runtime readiness.

## Canonical paths
| Path | Sole responsibility |
| --- | --- |
| `AGENTS.md` | agent conduct, authorization and proof |
| `REPOSITORY-STRUCTURE.md` | placement, naming and consumer-cutover law |
| `governance/` | **future canonical** durable Product/System/Policy decisions; currently NOT_READY in its README |
| `docs/REFOUNDATION-PLAN.md` | one temporary execution plan, conflicts, evidence and stage gates; never business policy |
| `docs/reference/` | preserved, explicitly nonbinding research, OSS, competitors, donor evidence and links when migrated |
| `.github/` | CI workflow wiring, PR and ownership routing, review-provider config |
| `tools/governance/` | deterministic foundation/architecture checks and their tests, not another decision catalog |
| `tools/security/` | shared security scanners when actually needed |
| `tools/dev/` | genuinely repository-wide developer tooling |
| `services/<owner>/` | each backend owner's implementation, contracts, SQL/migrations, service-specific tests and utilities when authorized to rebuild |
| `apps/<surface>/` | actual presentation hosts for Customer, Merchant, Captain, Operator |
| `packages/<purpose>/` | proven multi-consumer domain-neutral packages only |
| `tests/` | integration proof spanning genuine owners; not duplicate unit tests |

## Transitional rule for this worktree
- The former `docs/governance/` directory is **absent from this candidate by explicit user decision**. Its content remains inspectable in original branch `41` and archived inputs; do not restore it to this worktree.
- `governance/` is the only **target** policy path. Its README advertises NOT_READY until all applicable decisions and 26 capability IDs are reconciled, rather than an unsafe partial authority switch.
- The foundation guard rejects reintroduction of `docs/governance/`. Translate surviving references directly to the owning new files as each decision is adopted. Keep historical provenance external to the candidate, not another active governance directory.
- No domain code or SQL is introduced in the foundation-only stage.

## Placement and simplification law
1. Put authored logic with the owner of **its changing responsibility**, not a historical screen, team, refoundation batch name or convenience folder.
2. Business records and mutations belong to their service owners; apps compose views and invoke contracts, they never become a second business writer.
3. Each exposed API and generated client has a recorded original source; derived files must be reproducible and are never hand-maintained as independent truth.
4. One Store ID and one DSH commerce engine serve Store relation variants. An owner-person and an owned Store must never be collapsed into one entity or identity.
5. Prefer explicit stable domain names. Avoid `shared`, `common`, `misc`, `legacy`, `new`, `v2`, dates in **live code names**, and old workflow vocabulary without justified semantics.
6. Before removing or relocating a file, trace all direct/dynamic consumers, database schema references, environment keys, routes, tests and external identity/URL contracts. Transfer unique behavior, change consumers, prove it, then remove the losing implementation.
7. No number-of-files target, mandatory 'clean' architecture folder ladder, or second configuration/permission/financial policy writer.
8. Preserve externally issued Expo app package/bundle IDs, EAS project identity, deep links, signing identities and historical financial/legal records until an independently approved migration proves safety.
9. A new general tool/package requires at least one established cross-owner consumer and a reason owner-local code is inadequate.
10. Reference/benchmark URLs retain original evidence status, publication date and usage caveats; never become copied product rules.

## Structural closure
A slice is structurally accepted only when the winning path, every affected consumer, generated API, SQL/config reference and test is updated, the losing path is gone, and source/runtime proof is tied to the exact accepted revision. Otherwise report NOT_RUN, BLOCKED or REVIEW_BLOCKED; do not infer correctness from Git status alone.
