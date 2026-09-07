# Verification, Falsification and Closure Router

OWNER_ROLE: VERIFICATION_FALSIFICATION_CLOSURE_ROUTER
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: BEFORE_VERIFICATION_FALSIFICATION_OR_CLOSURE

## 1. Purpose

Route proof to one canonical verification owner. This file does not restate detailed gates.

## 2. Verification submodules

- `verify/evidence-falsification.md` — evidence provenance, falsification, proof limits and failure classification.
- `verify/surface-runtime-and-journey-proof.md` — rendered web/mobile interaction, journey, cross-surface handoff and real-runtime proof.
- `verify/structural-conformance.md` — structural/substrate/root conformance for the materially affected cone.
- `verify/unit-and-scope-closure.md` — semantic execution-unit and authorized-scope fixed-point closure.

## 3. Composition

~~~text
IDENTIFY CLAIM
→ LOAD APPLICABLE GOVERNANCE OWNER
→ LOAD ONLY MATERIAL VERIFICATION SUBMODULES
→ VERIFY EXACT CANDIDATE / EXACT PROOF SCOPE
→ EMIT PASS/FAIL + INVALIDATION TRIGGERS
~~~

A structural failure returns to diagnosis. A unit closure emits `UNIT_CLOSED`; `05` owns movement.

## 4. Boundaries

Verification does not select Product breadth, diagnose root dominance, mutate the repository or define movement.
