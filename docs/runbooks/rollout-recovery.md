# Progressive Rollout Recovery Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: Platform Control operations

Current Platform Control contracts, permissions, migrations and rollout state machine override stale endpoint/workflow names.

## Ownership

Platform Control owns rollout state, feature-flag mutation, health gating, audit and captured-baseline restoration. Other control-panel code is an authorized operating surface only. Target applications consume effective rollout state and do not persist a parallel rollout truth.

## Target scope

Every rollout must use explicit governed targeting supported by the current contract. Empty/unknown target selectors must fail closed. Never widen targeting during incident recovery merely to make an operation succeed.

## Lifecycle rules

- Create rollout only from the state allowed by the current change-set/rollout contract.
- Advance/resume only through server-owned health gates.
- Pause must preserve percentage/step/revision unless the canonical state machine says otherwise.
- Abort/rollback restore the captured baseline through optimistic concurrency; never overwrite a newer external feature-flag revision.
- The UI displays server-derived legal actions and recovery guidance; it does not invent legal transitions locally.

## Incident procedure — running rollout

1. Pause through the current governed action.
2. Verify canonical readback and unchanged rollout revision/percentage as required.
3. Read the current recovery/health model.
4. Inspect required-service health and correlated audit events.
5. If risk is cleared and health permits, resume without implicitly advancing.
6. If risk is confirmed/unresolved, abort/restore the captured baseline through the governed action.
7. Verify effective runtime configuration on affected surfaces.

## Incident procedure — completed rollout

1. Read current recovery state and approved rollback/roll-forward plan.
2. Confirm the incident is causally related to the rollout.
3. Execute only the legal rollback/recovery transition.
4. Verify persisted rollout state, feature-flag revision and effective target behavior.
5. Verify consuming surfaces read the restored canonical state.

## Failed health gate

A failed health gate must not mutate rollout/flag state. Preserve the attempted actor, correlation identity, current rollout revision/percentage and health evidence in audit according to the current contract.

## Verification

Use the current registered Platform Control/backend/typecheck/contract/boundary/runtime checks. A workflow path is evidence only if it exists on the reviewed commit and actually ran against that commit.

Production deployment, visual acceptance, security, QA, product-owner and release acceptance remain separate evidence/approval domains where current governance requires them.
