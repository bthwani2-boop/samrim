# Verification — Interactive Surface Runtime and Journey Proof

ARTIFACT_CLASS: ORCHESTRATOR_VERIFICATION_SUBMODULE
OWNER_ROLE: INTERACTIVE_SURFACE_RUNTIME_JOURNEY_PROOF
AUTHORITY_ASSIGNED_BY: 04-VERIFY-REDIAGNOSE-CLOSE.md
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: WHEN_A_MATERIAL_WEB_MOBILE_HYBRID_OR_OPERATOR_SURFACE_CLAIM_REQUIRES_RENDERED_RUNTIME_OR_JOURNEY_PROOF

This submodule owns the proof semantics for materially affected interactive surfaces. It does not choose Product scope, define UX/Product meaning, prescribe a permanent tool vendor, mutate the repository or own terminal movement.

## 1. Applicability

Load this module when a closure claim depends materially on a rendered web/mobile/hybrid surface, user/operator interaction, device/browser runtime behavior, navigation/deep-link handoff, or a journey crossing more than one deployable surface.

Do not force interactive proof for a change whose claim is fully proven below the surface layer. Conversely, source inspection, typecheck, build or API-only evidence cannot replace required rendered/runtime proof.

## 2. Proof-strength law

~~~text
SOURCE/TYPECHECK/BUILD PASS != RENDERED RUNTIME PASS
RENDERED ELEMENT EXISTS     != INTERACTION WORKS
INTERACTION WORKS           != CANONICAL EFFECT OCCURRED
CANONICAL EFFECT OCCURRED   != REQUIRED READBACK IS CORRECT
SCREENSHOT                  != BEHAVIORAL JOURNEY PROOF
EXPLORATORY SUCCESS         != DURABLE REGRESSION PROOF
MCP TRANSPORT               != STRONGER EVIDENCE CLASS
~~~

A screenshot is valid primary evidence only for a visual claim it can actually prove. For behavioral claims it is supporting evidence unless paired with interaction/effect/readback proof.

## 3. Tool-selection law

Select the smallest adequate existing evidence producer for the claim. Resolve current concrete tool roles from executable configuration and `docs/development/quality/quality-and-verification.md`; this module intentionally keeps mutable vendor/tool names out of execution law.

~~~text
CLAIM
→ MATERIAL RUNTIME/SURFACE
→ REQUIRED OBSERVABILITY + CONTROL
→ SMALLEST ADEQUATE TRUSTED TOOL
→ EXACT-CANDIDATE PROOF
~~~

Prefer an already installed/declared, reliable mechanism with semantic selectors/refs and attributable output. Do not add a second framework merely because another tool can perform the same clicks.

Exploration and durable regression are different needs:

- exploratory control may be ad hoc when discovering/falsifying current behavior;
- a material regression claim expected to survive the change should use the smallest durable repeatable flow/test/replay that proves it;
- if one existing mechanism provides both adequately, reuse it;
- introduce a second mechanism only for a materially different evidence need, platform gap or owned existing suite.

A GUI/visual authoring tool may accelerate human work but is not an authority and does not replace the underlying repeatable evidence.

## 4. Web runtime proof

When a material web surface is affected, verify the applicable chain in an actual browser runtime:

~~~text
ENTRY/URL/ROUTE
→ RENDERED/ACCESSIBLE TARGET
→ INTERACTION
→ REQUEST/EVENT WHEN MATERIAL
→ CANONICAL OWNER EFFECT
→ PERSISTED/OBSERVABLE READBACK
→ FINAL VISIBLE/NAVIGATION STATE
→ MATERIAL ERROR/RECOVERY PATH
~~~

Use semantic/accessibility/role-based targeting where practical. Inspect network, console, storage/session or browser state only when they can falsify the claim; do not collect them ritualistically.

A browser DOM assertion proves DOM/runtime state, not server authorization or persistence unless the required effect/readback is independently connected.

## 5. Mobile runtime proof

When a material mobile surface is affected, bind evidence to the intended app identity/build/runtime and selected device/simulator/emulator.

Exercise, when material:

~~~text
LAUNCH/RESUME
→ SEMANTIC VIEW STATE
→ TAP/TYPE/GESTURE/KEYBOARD
→ PERMISSION/SYSTEM HANDOFF
→ REQUEST/EFFECT
→ CANONICAL READBACK
→ NAVIGATION/DEEP LINK
→ FAILURE/RETRY/RECOVERY
~~~

Prefer semantic view/accessibility targeting over brittle coordinates where the platform exposes adequate semantics.

## 6. Real-device escalation

A real device is required when the claim materially depends on behavior that a simulator/emulator cannot adequately establish, including applicable:

- OS lifecycle/background/process-death behavior;
- push notification receive/tap behavior;
- real permission and battery/background restrictions;
- location/GPS behavior;
- camera/media/device integration;
- hardware-/OEM-specific behavior;
- weak/intermittent real-network behavior when simulation would not prove the claim;
- materially representative performance/resource behavior.

For claims independent of those properties, a representative simulator/emulator may be adequate. Do not require real-device evidence ritualistically, and do not substitute an emulator when the claim is explicitly about real-device behavior.

## 7. Cross-surface journey proof

When one authorized journey crosses surfaces, prove the material handoff rather than certifying each surface in isolation.

Example shape:

~~~text
WEB/OPERATOR ACTION
→ CANONICAL MUTATION
→ MOBILE/OTHER SURFACE CONSUMPTION
→ CANONICAL EFFECT/STATE TRANSITION
→ REQUIRED READBACK ON AFFECTED SURFACE(S)
~~~

Different tools may be used for different surfaces. Their outputs compose only when candidate/config/actor/state provenance shows they exercised the same material journey.

## 8. Agent execution loop

For agent-driven interactive verification:

~~~text
OPEN CORRECT RUNTIME
→ INSPECT CURRENT SEMANTIC STATE
→ ACT ON OBSERVED TARGETS
→ RE-INSPECT AFTER STATE CHANGE
→ FALSIFY EXPECTED EFFECT
→ CAPTURE FAILURE EVIDENCE IF NEEDED
→ STABILIZE SELECTORS/FLOW
→ PERSIST REPEATABLE PROOF WHEN MATERIAL
→ RE-RUN AGAINST EXACT CANDIDATE
~~~

Do not continue acting on stale element references after a material screen/navigation change when the selected tool requires refreshed state.

An in-scope defect discovered here is not a reporting stop: return it to `../02-DIAGNOSE-ROOT-CAUSE.md`; after treatment through `../03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md`, re-run the material proof on the resulting exact candidate.

## 9. Failure classification

Interactive failures must be classified before treatment or rerun as far as evidence permits:

~~~text
PRODUCT/CODE DEFECT
CONTRACT/AUTHORIZATION/DATA DEFECT
STALE OR WRONG BUILD/CANDIDATE
RUNTIME/CONFIG/ENVIRONMENT MISMATCH
DEVICE/BROWSER/PLATFORM CONDITION
STALE OR BRITTLE SELECTOR/FLOW
TOOL LIMITATION/FAILURE
NONDETERMINISTIC RACE/FLAKE
UNKNOWN REQUIRING DIAGNOSIS
~~~

A passing manual retry does not erase an unexplained failure. Do not weaken selectors/assertions, add arbitrary sleeps or bypass real errors to manufacture green.

## 10. Evidence provenance

For each material interactive claim, preserve or reconstruct as applicable:

~~~text
TARGET_HEAD_SHA
SURFACE / APP OR WEB IDENTITY
BUILD / PROCESS / BROWSER / DEVICE IDENTITY
CONFIG / ENV CLASS
ACTOR / AUTHORIZATION CONTEXT
TEST DATA OR STATE PRECONDITION
ACTION / ASSERTION OR REPLAY IDENTITY
CANONICAL EFFECT / READBACK
RESULT
FAILURE ARTIFACTS WHEN PRESENT
PROOF LIMIT
INVALIDATION TRIGGER
~~~

Sensitive credentials, tokens and personal data are not evidence artifacts and must not be persisted merely for reproducibility.

## 11. Closure gate

A material interactive surface claim may contribute to unit closure only when:

~~~text
CORRECT SURFACE/RUNTIME PROVEN
+ MATERIAL INTERACTION PROVEN
+ REQUIRED CANONICAL EFFECT PROVEN
+ REQUIRED READBACK PROVEN
+ MATERIAL FAILURE/RECOVERY PROVEN
+ EXACT-CANDIDATE PROVENANCE SUFFICIENT
+ NO KNOWN MATERIAL UNTESTED AFFECTED SURFACE/HANDOFF
+ NO DUPLICATE ASSURANCE FRAMEWORK INTRODUCED WITHOUT UNIQUE NEED
~~~

This module emits evidence results only. Unit/scope closure remains with `unit-and-scope-closure.md`; failure-driven diagnosis returns to `../02-DIAGNOSE-ROOT-CAUSE.md`.
