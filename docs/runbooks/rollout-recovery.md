# Progressive Rollout Recovery Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
DOCUMENT_STATUS: CONDITIONAL_TARGET_GUIDANCE
USE_AS_CURRENT_OPERATIONAL_RUNBOOK: ONLY_AFTER_EXECUTABLE_ROLLOUT_OWNER_MATERIALIZATION

Status: CONDITIONAL_TARGET_GUIDANCE
Semantic owner: Platform Control control-plane responsibility
Executable owner: derive from exact-current implementation; independent `services/platform-control` deployment is not assumed.

Do not use the procedures below as current operational commands until executable evidence proves the current rollout contract/state machine, permission boundary, and canonical writer. If that responsibility is rehomed rather than deployed as Platform Control, operate the rehomed owner.

## Ownership

The admitted Platform Control semantic responsibility owns governed rollout meaning when that responsibility exists. The exact executable writer/runtime must be proven on the current candidate before operation. Control Panel is an operating surface only; target applications consume effective rollout state and do not persist a parallel rollout truth.

## Target scope

Every rollout must use explicit governed targeting supported by the current executable contract. Empty or unknown target selectors fail closed. Never widen targeting during incident recovery merely to make an operation succeed.

## Lifecycle rules

- Create rollout only from a state allowed by the current owner state machine.
- Advance/resume only through owner-side health gates.
- Pause preserves percentage/step/revision unless current semantics say otherwise.
- Abort/rollback restores the captured governed baseline through optimistic concurrency and never overwrites a newer revision.
- UI displays server-derived legal actions; it does not invent transitions.

## Incident procedure — running rollout

1. Pin the exact candidate and executable owner.
2. Pause through the current governed action if that action exists and is legal.
3. Verify canonical readback and current revision/percentage.
4. Inspect current recovery/health evidence and correlated audit events.
5. Resume only when current owner gates permit it.
6. Otherwise abort/restore through the legal owner transition.
7. Verify effective runtime configuration on affected consumers.

## Incident procedure — completed rollout

1. Read current owner recovery state and approved rollback/roll-forward plan.
2. Confirm the incident is causally related to the rollout.
3. Execute only a legal current-owner recovery transition.
4. Verify persisted state/revision and effective target behavior.
5. Verify consuming surfaces read the restored canonical state.

## Failed health gate

A failed health gate must not mutate rollout/flag state unless current governance explicitly defines that effect. Preserve actor, correlation identity, revision/percentage, and health evidence in the owning audit model.

## Verification

Use only current registered checks for the executable owner actually materialized on the candidate. A workflow path is evidence only if it exists and ran against the exact candidate.

Production deployment, visual acceptance, security, QA, Product-owner, and release acceptance remain separate evidence/approval domains where Governance requires them.
