# Verification — Unit and Authorized-Scope Closure

ARTIFACT_CLASS: ORCHESTRATOR_VERIFICATION_SUBMODULE
OWNER_ROLE: UNIT_AND_AUTHORIZED_SCOPE_CLOSURE
AUTHORITY_ASSIGNED_BY: 04-VERIFY-REDIAGNOSE-CLOSE.md
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: WHEN_UNIT_OR_AUTHORIZED_SCOPE_CLOSURE_IS_CLAIMED

## 1. Unit closure

An execution unit closes only when the exact candidate proves the materially affected vertical chain and negative space required by that unit.

Applicable proof may include:

~~~text
AUTHORIZED PRODUCT/SYSTEM OUTCOME
CANONICAL OWNER / WRITER
DATA / MIGRATION
CONTRACT / EVENT / GENERATED BINDING
RUNTIME / CONFIG / PROVIDER
REQUIRED CONSUMERS / SURFACES
AUTHORIZATION / SECURITY / PRIVACY
FINANCIAL INVARIANTS / RECONCILIATION
FAILURE / RETRY / UNKNOWN / RECOVERY
CANONICAL READBACK
TEST / RUNTIME / DEVICE / VISUAL EVIDENCE
LOSING WRITERS / READERS / WRAPPERS / ALIASES = 0 IN AFFECTED CONE
~~~

Only materially applicable rows are required; the proof scope must be explicit.

## 2. Explicit vertical increment

A unit may be a full capability or an explicitly authorized vertical increment.

An increment is valid only when:

- its Product meaning/boundary is explicit;
- it uses final canonical owners/models;
- every materially affected axis for that increment is connected;
- no temporary architecture is introduced merely because Product breadth is smaller;
- future unrelated breadth remains absent.

A backend-only, frontend-only or contract-only fragment is not closed if the authorized outcome requires the rest of the chain.

## 3. No-forgotten-surface gate

Before unit closure, account for every materially affected deployable surface and system consumer as one of:

~~~text
REQUIRED_AND_PROVEN
NOT_AFFECTED_WITH_REASON
EXPLICITLY_OUTSIDE_AUTHORIZED_PRODUCT_SCOPE
SUPERSEDED_AND_REMOVED
~~~

A hidden or untested material consumer keeps the unit open.

## 4. Unit result

On success emit exactly:

~~~text
UNIT_CLOSED
~~~

A commit/checkpoint is not equivalent to `UNIT_CLOSED`.

## 5. Structural invalidation

If unit proof exposes wrong ownership/topology/substrate in the affected cone, emit:

~~~text
STRUCTURAL_REDIAGNOSIS_REQUIRED
~~~

Then `02` rebuilds the causal graph and `05` owns movement. There is no global structural phase transition.

## 6. Authorized-scope fixed point

The first empty root list is not enough. Re-census and falsify from the appropriate proof scope.

For `ACTIVE_SLICE`:

~~~text
AUTHORIZED OUTCOME = PROVEN
REQUIRED AFFECTED CONE = ACCOUNTED
KNOWN REQUIRED OPEN ROOTS = 0
KNOWN REQUIRED LOSING/SHADOW AUTHORITIES = 0
INVALIDATED PRIOR EVIDENCE = REPROVEN
MATERIAL NEGATIVE SPACE = PASS
AUTHORIZED_SCOPE_LEVEL_4_FIXED_POINT = PASS
~~~

Then emit:

~~~text
BTHWANI_ACTIVE_PRODUCT_SLICE_LEVEL_4_COMPLETE
~~~

For explicit `FULL_TARGET`, apply the same semantics repository-wide and emit the full-target terminal token defined by the invocation contract.

## 7. Deferred future breadth

Unimplemented future capabilities outside the authorized slice do not block active-slice closure and must not be represented by fake routes, tables, endpoints, screens or placeholder state.

`LEVEL_4` never authorizes future Product breadth.

## 8. Evidence freshness

Every closure claim is attributable to exact candidate identity and proof inputs. Shared-owner changes invalidate only materially affected previous evidence, which must be re-run before the new fixed point is accepted.

## 9. Deployable/release provenance

When a closure claim includes build/release behavior, preserve exact materially applicable source SHA, dependency/toolchain/generated/configuration/build identity and deployable package/bundle/signing/update identity.

Repository path movement is not automatically a deployable-identity change. An intentional external identity change requires explicit migration and evidence under the delivery-policy family.

## 10. Stop boundary

A proven authorized-scope fixed point is a normal terminal result. It does not authorize the next future Product slice.

A blocker may stop earlier only under `../01-SCOPE-AUTHORITY-RULES.md`.
