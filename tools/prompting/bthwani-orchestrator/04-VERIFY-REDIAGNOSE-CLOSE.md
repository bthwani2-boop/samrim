# Verification, Falsification and Fixed-Point Closure

OWNER_ROLE: VERIFICATION_FALSIFICATION_CLOSURE_ROUTER
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: BEFORE_VERIFICATION_FALSIFICATION_RECENSUS_OR_CLOSURE

## 1. Purpose

This file is the sole Orchestrator router for verification/falsification/closure law. It owns **which verification submodule applies and how their outputs compose**. Detailed law lives only in the routed submodule; do not duplicate it here.

```text
02 = DIAGNOSE/RANK
03 = MUTATE/CUTOVER/DELETE
04 = VERIFY/FALSIFY/CLOSE
05 = MOVE/STATE TRANSITION
```

Product/System meaning comes from applicable Governance owners. Current implementation truth comes from exact executable source/runtime evidence. Verification never invents either.

## 2. Verification submodules

Load only what can affect the claim:

- `verify/evidence-falsification.md` — evidence provenance, finding terminality, assurance assets, falsification, proof limits, runtime provenance, failure classification and no-documentation-only closure.
- `verify/structural-qualification.md` — A0/A1 admission, Foundation Construction exit, A2 structural qualification, donor exhaustion and clean-target qualification.
- `verify/unit-fixed-point.md` — execution-unit closure, surface/action completeness, Stage-B closure, active-slice/full-target fixed points and release/deployable provenance.

```text
ONE VERIFICATION RULE → ONE SUBMODULE
ROUTER SUMMARY != SECOND LAW
SUBMODULE SELF-CERTIFICATION = FORBIDDEN
```

## 3. Composition protocol

For a concrete claim:

```text
IDENTIFY CLAIM CLASS
→ LOAD APPLICABLE GOVERNANCE OWNERS
→ LOAD EVIDENCE/FALSIFICATION SUBMODULE WHEN EVIDENCE QUALITY OR NEGATIVE SPACE IS MATERIAL
→ LOAD STRUCTURAL SUBMODULE WHEN A0/A1/FOUNDATION/A2/DONOR/CLEAN-TARGET QUALIFICATION IS MATERIAL
→ LOAD UNIT/FIXED-POINT SUBMODULE WHEN UNIT OR AUTHORIZED-SCOPE CLOSURE IS MATERIAL
→ EMIT ONLY CLAIMS PROVEN ON THE EXACT CANDIDATE
```

A submodule failure keeps the affected claim open. A closed unit emits `UNIT_CLOSED`; `05-EXECUTION-PLAYBOOK.md` owns what movement follows. A structural disproof emits the applicable stale/failure result; `02` diagnoses the new root and `05` routes execution.

## 4. Non-authority boundaries

This verification package does not:

- select or expand Product breadth;
- redefine Governance semantics;
- diagnose root dominance;
- mutate/cut over/delete;
- define the runtime-state machine;
- treat commits/checkpoints/docs as proof by themselves.

```text
VERIFICATION != PRODUCT AUTHORITY
VERIFICATION != DIAGNOSIS
VERIFICATION != MUTATION
VERIFICATION != MOVEMENT
```
