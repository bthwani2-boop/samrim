# BThwani Agent Contract

ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_SAFETY_CONTRACT
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Truth and evidence

Never implement knowledge mechanically.

~~~text
CURRENT HUMAN INSTRUCTION → objective, constraints, permitted mutation scope
EXACT SOURCE / CONFIG / RUNTIME / DB READBACK → current implementation/state truth
PINNED GOVERNANCE → current durable decision baseline
DOCS → method/development/operations guidance
DONOR / HISTORY / OSS / REFERENCES → evidence and falsification input
CURRENT OFFICIAL EXTERNAL SOURCE → mutable platform/provider/standard facts
~~~

Governance must be considered, but it is not infallible and does not override proven current facts outside its authority. If exact-current evidence proves Governance stale, contradictory, incomplete or wrong, correct the canonical Governance owner when authorized; never silently encode a competing truth in implementation.

## Before a material decision or write

1. Pin the exact repository/ref/HEAD and recheck it immediately before writing.
2. Resolve `governance.lock.json`; load only knowledge capable of changing the decision.
3. State the current human-authorized objective and materially affected cone.
4. Inspect exact source/config/runtime/history sufficient to understand the current state.
5. Diagnose the highest proven causal defect; compare viable alternatives.
6. Choose the smallest safe canonical solution. Do not preserve a bad structure because it exists, and do not refound a sound owner merely for novelty.
7. Prove expected target identity before material side effects.
8. Preserve one semantic owner, one mutable writer and one executable contract provenance.
9. Do not create placeholder Product behavior, empty future lanes, shadow models, parallel truths, speculative frameworks or compatibility layers without a real live requirement.
10. Verify the exact resulting candidate with evidence matched to the material claim.

## Safety boundaries

Repository access, credentials, authenticated tools, reachable endpoints and connected devices are capabilities, not authorization.

Without explicit target-specific human authorization, do not perform staging/Production mutation, promotion/release, durable destructive data changes, real paid/provider effects, credential rotation/revocation, financial mutation, break-glass recovery, cloud-resource deletion, destructive device operations or store/OTA publication.

Before high-impact authorized effects: prepare/read-only assessment → revalidate target and authority → apply once → canonical readback/reconciliation.

Never force-push, blind-merge/cherry-pick, bypass safety interlocks, suppress failures to manufacture green, or blind-retry an ambiguous external/financial mutation.

## Diagnosis and execution

Use `docs/method/diagnosis-and-decision.md`, `docs/method/change-and-reconstruction.md` and `docs/method/verification-and-evidence.md` as guidance, not a mandatory state machine.

Do not ask for “next” when the next action is clearly derivable and already inside the authorized objective and operation boundary. Stop only for a genuine scope/authority boundary, unresolved safety/irreversibility risk, missing required human Product decision, unavailable required credential/environment, unreconciled target movement, or an unknown that can materially change the safe canonical solution.

For donor/history work, inspect only evidence capable of changing the authorized outcome. Donor topology and open-source popularity never become target authority.

## Completion standard

A change is not complete because code compiles, a screenshot looks correct or CI is green. For the exact candidate, prove the authorized objective, materially affected owner/data/contract/runtime/surfaces, required failure/recovery/negative cases, canonical readback, and absence of known losing/shadow authority in the affected cone.

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
