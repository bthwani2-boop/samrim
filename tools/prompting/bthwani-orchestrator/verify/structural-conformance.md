# Verification — Structural Conformance

ARTIFACT_CLASS: ORCHESTRATOR_VERIFICATION_SUBMODULE
OWNER_ROLE: STRUCTURAL_CONFORMANCE
AUTHORITY_ASSIGNED_BY: 04-VERIFY-REDIAGNOSE-CLOSE.md
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: WHEN_STRUCTURAL_OR_SUBSTRATE_CLAIMS_ARE_MATERIAL

## 1. Scope

Verify only structural claims material to the current root/affected cone unless `FULL_TARGET` explicitly requires repository-wide proof.

No A0/A1/A2 or pre-Product gate exists.

## 2. Root-execution readiness

Before destructive/refoundation mutation, evidence must be sufficient to establish:

~~~text
SELECTED ROOT / SOURCE OF DEFECT
CANONICAL TARGET / SOURCE OF FIX
AFFECTED CONE
TRUTH / DEPLOYABLE IDENTITY TO PRESERVE
SAFE MIGRATION / CUTOVER PATH
EXPECTED LOSERS / PRUNING
NO RANKING-RELEVANT UNKNOWN THAT CAN CHANGE SAFETY/TARGET
~~~

This is not a global repository admission gate.

## 3. Structural-substrate conformance

When `profiles/structural-substrate.md` was activated, verify the materially applicable affected cone:

~~~text
CANONICAL OWNER/PATH = PASS
WORKSPACE/MANIFEST/LOCKFILE CONSISTENCY = PASS
REQUIRED BUILD/TYPECHECK/TEST/VET = PASS
REQUIRED HOST/SERVICE RUNTIME = PASS
REQUIRED HEALTH/READINESS = PASS
REQUIRED DATA/CONTRACT/MIGRATION LINEAGE = PASS
REQUIRED CONFIG/INFRA COMPOSITION = PASS
REQUIRED DOC/COMMAND PARITY = PASS
LOSING/SHADOW STRUCTURE = 0
EMPTY FUTURE LANES = 0
PREMATURE PRODUCT FURNISHING = 0
~~~

Only claims actually material to the structural root are required.

## 4. Repository-wide structural fixed point

Apply repository-wide structural falsification only for:

- explicit `FULL_TARGET`; or
- a selected root whose causal cone is repository-wide.

Then prove zero known material wrong-owner/duplicate-writer/dead-container/compatibility-only/unjustified-wrapper/legacy structural findings in that authorized scope.

## 5. Donor exhaustion

For `ACTIVE_SLICE`, donor proof is scoped to the material donor cone of the authorized outcome.

For `FULL_TARGET`, repository-wide donor exhaustion may be required.

Both prove preservation/disposition of required truth, never copying of donor topology.

## 6. Result

Emit structural claim pass/fail plus exact proof scope and invalidation triggers. Movement belongs to `05`; semantic Product closure belongs to the unit/scope closure submodule.
