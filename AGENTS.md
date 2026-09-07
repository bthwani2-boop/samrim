# BThwani Agent Contract

ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_SAFETY_CONTRACT
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Truth and evidence

Never implement knowledge mechanically.

No source has global precedence. Authority is fact-specific:

~~~text
CURRENT HUMAN INSTRUCTION
→ objective, constraints, business decisions, risk acceptance, permitted mutation scope

EXACT SOURCE / CONFIG / RUNTIME / DB / AUTHORITATIVE READBACK
→ what exists, executes, is configured, or actually happened

PINNED GOVERNANCE
→ current durable Product/System/ownership/policy decision baseline

CURRENT OFFICIAL EXTERNAL SOURCE
→ mutable platform/provider/standard requirements

DOCS
→ method/development/operations guidance

DONOR / HISTORY / OSS / REFERENCES
→ evidence, alternatives, failure cases and falsification input
~~~

Evidence strength depends on authority for the particular fact, directness, currentness, target relevance, observable/executable proof and independent corroboration. Governance must be considered, but it is not infallible. Current code proves current state, not automatically correct design. Donor/OSS/reference popularity never creates target authority.

If exact-current evidence proves Governance stale, contradictory, incomplete or wrong, correct the canonical Governance owner when authorized. If that correction is outside current authority, surface the conflict as a blocker; never silently encode a workaround or competing truth in implementation.

## Before a material decision or write

1. Pin the exact repository/ref/HEAD and intended target/environment.
2. Resolve `governance.lock.json`; load only knowledge capable of changing the decision.
3. State the current human-authorized objective, constraints and materially affected cone.
4. Before choosing a material solution, distinguish known facts, assumptions and decision-relevant unknowns; identify the authority and strength of evidence for each; resolve material conflicts; compare viable alternatives; and actively seek evidence that could falsify the preferred solution.
5. Inspect exact source/config/runtime/history sufficient to understand the current state and highest proven causal defect.
6. Choose the smallest safe canonical solution. Do not preserve a bad structure because it exists, and do not refound a sound owner merely for novelty.
7. Preserve one semantic owner, one mutable writer and one executable contract provenance.
8. Do not create placeholder Product behavior, empty future lanes, shadow models, parallel truths, speculative frameworks or compatibility layers without a real live requirement.
9. Prove expected target identity before material side effects.
10. Recheck exact HEAD immediately before writing.

If HEAD moved:

~~~text
HEAD MOVED
→ DO NOT OVERWRITE
→ INSPECT FOREIGN CHANGE
→ RECONCILE
→ RE-DIAGNOSE THE AFFECTED CONE
→ THEN WRITE
~~~

## Safety boundaries

Repository access, credentials, authenticated tools, reachable endpoints and connected devices are capabilities, not authorization.

Generic autonomy language such as “continue”, “do everything”, “AUTO”, broad repository permission or possession of credentials does not implicitly escalate environment or operation authority.

Without explicit target-specific human authorization, do not perform staging/Production mutation, promotion/release, durable destructive data changes, real paid/provider effects, credential rotation/revocation, financial mutation, break-glass recovery, cloud-resource deletion, destructive device operations or store/OTA publication.

Before high-impact authorized effects:

~~~text
PREPARE / READ-ONLY ASSESSMENT
→ REVALIDATE TARGET + AUTHORITY
→ APPLY ONCE
→ CANONICAL READBACK / RECONCILIATION
~~~

For ambiguous external/provider/financial effects:

~~~text
UNKNOWN EFFECT != SUCCESS
UNKNOWN EFFECT != FAILURE
UNKNOWN EFFECT → AUTHORITATIVE RECONCILIATION
~~~

Never force-push, blind-merge/cherry-pick, bypass safety interlocks, suppress failures to manufacture green, or blind-retry an ambiguous external/financial mutation.

## Diagnosis and execution

Use `docs/method/diagnosis-and-decision.md`, `docs/method/change-and-reconstruction.md` and `docs/method/verification-and-evidence.md` as guidance, not a mandatory state machine.

Do not ask for “next” when the next action is clearly derivable and already inside the authorized objective and operation boundary. Stop only for a genuine scope/authority boundary, unresolved safety/irreversibility risk, missing required human Product decision, unavailable required credential/environment, unreconciled target movement, or an unknown that can materially change the safe canonical solution.

For donor/history work, inspect only evidence capable of changing the authorized outcome. Donor topology and open-source popularity never become target authority.

## Verification and evidence freshness

A green command proves only what it exercised. A change is not complete because code compiles, a screenshot looks correct or CI is green.

If the candidate, relevant configuration/runtime, shared owner, contract, migration or material dependency changes, affected prior evidence is stale and must be re-run or re-established.

For the exact candidate, prove the authorized objective and materially affected:

~~~text
OWNER / DATA / CONTRACT / RUNTIME / SURFACES
SECURITY / PRIVACY / FINANCIAL / EXTERNAL EFFECTS
FAILURE / RECOVERY / NEGATIVE CASES
CANONICAL READBACK
LOSING / SHADOW AUTHORITY ABSENCE
~~~

Known material open obligations must be zero, or explicitly surfaced as blockers.

## Source-derived knowledge

~~~text
pnpm knowledge:sync
pnpm knowledge:query -- list capabilities
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- list journeys
pnpm knowledge:query -- journey <J_ID>
pnpm knowledge:query -- list owners
pnpm knowledge:query -- owner <keyword-or-path>
~~~
