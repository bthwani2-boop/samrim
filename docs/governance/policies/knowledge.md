# Knowledge Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/knowledge.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Durable knowledge

- New durable meaning updates the existing correct semantic owner when possible; learning does not mechanically create files.
- Wrong, stale or duplicate live meaning is corrected, merged or deleted; Git preserves history.
- Research output is distilled into current BThwani invariants, decisions, constraints or evidence requirements, then the transcript is discarded from live Governance.
- Mutable external facts are revalidated at actual use.
- Verifiers protect deterministic relationships/invariants and do not become prose or semantic authorities.
- Future Product concepts remain absent until admitted by current need.

## Evidence routing

For each material question, determine which evidence classes can materially change need, owner, boundary, risk, solution or proof:

```text
LIVE BTHWANI
CURRENT GOVERNANCE
DONOR / HISTORY
OSS / PRODUCT EXEMPLARS
YEMEN-MARKET / COMPETITOR EVIDENCE
PRIMARY TECHNOLOGY SOURCES
NORMATIVE / ASSURANCE SOURCES
EXPERIENCE / DESIGN SOURCES
CURRENT ECOSYSTEM / TOOLING DISCOVERY
```

Inspect applicable lanes adequately and skip clearly irrelevant lanes. Source count is not evidence strength. Authority, independence, directness, currentness and BThwani applicability determine weight.

Donor, OSS and competitors may reveal lost semantics, edge cases, state machines, failure/recovery behavior, experience patterns or test oracles. None grants adoption authority or the right to copy topology, visual identity or obsolete implementation.

## Technology opportunity and stability

BThwani must not remain on an unnecessarily costly mechanism merely because it already exists, and must not chase novelty merely because it is newer.

When a technology/tool/platform boundary is materially extended, refounded, costly to operate, deprecated, security-sensitive or blocking current work, inspect current primary evidence for alternatives or newly stable capabilities that can remove material custom complexity, risk or development cost.

A candidate is evaluated on:
- current material need and benefit;
- maturity/status (stable/GA/final versus beta/RC/canary/experimental/deprecated);
- compatibility and known regressions;
- security, license/provenance and maintenance;
- migration and rollback/exit cost;
- operational burden and complexity removed;
- claim-specific proof on BThwani.

The result is `ADOPT`, `DEFER` or `REJECT` for the current decision. Mutable versions and release status stay in current primary sources/executable configuration, not durable Governance.

Do not create a permanent technology-radar database, competitor matrix, dependency inventory or research backlog in Governance.

## External reference curation

One external URL is curated in one canonical reference class unless a second occurrence has a materially different purpose.

Reference existence never authorizes adoption. Reopen prior research only when the current question, constraints or disconfirming evidence can materially change the decision.
