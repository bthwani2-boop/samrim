# Partner Team Membership

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/partner/partner-team-membership.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: PARTNER_TEAM_MEMBERSHIP

## Scope

This file is the **sole editable durable semantic owner** of `PARTNER_TEAM_MEMBERSHIP`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### PARTNER_TEAM_MEMBERSHIP

**Problem.** Store-scoped partner team membership must have a real lifecycle and audit without becoming Identity permission truth or being conflated with captain identity/affiliation.

**Required outcome.** A published store can govern explicit partner-team membership with scoped role, lifecycle, versioned mutation and audit; Identity remains authentication/permission authority.

**Primary actors.** partner manager, partner supervisor, partner staff member, authorized operator/system.

**Canonical ownership.** DSH partner/team membership and store scope; Identity roles/permissions/session context remain separate.

**Material surfaces.** app-partner, control-panel; backend/database.

**Durable lifecycle.**
```text
invited → active
active → suspended | ended
suspended → active | ended
invited → ended
```
Resend-invite preserves `invited`; ended membership is not silently reused as active authority.

**Permitted actions.** invite within owned published store, pause/suspend, activate, block/end, resend invite, cancel invite, read canonical membership/audit according to authorization.

**Forbidden/negative invariants.**
- no implicit all-store access;
- no duplicate active/invited binding for the same scoped identity;
- no stale version update;
- no membership status grants authentication by itself;
- no partner surface edits Identity permission truth directly.

**Failure/recovery.** member/store not found, duplicate bound identity, invalid transition/action, version conflict, unauthorized scope; recover through canonical reread and valid next transition.

**Acceptance expectations.** every mutation is scoped, versioned, correlated/idempotent where retryable, audited from→to, and read back from DSH canonical membership.

**Target state.** One DSH partner-team membership lifecycle owns store-scoped operational membership while Identity remains authentication/permission/session authority.
**Primary success measure.** invited members reaching a correct scoped active/suspended/ended state with matching Identity authorization readback.
**Guardrail measures.** cross-store membership access; active membership without valid Identity binding; stale-version mutation; duplicate invite; local role authority in app.
**Business invariants**
- membership scope is explicit per partner/store;
- membership lifecycle and Identity permission/session facts remain separate owners;
- invite/activate/suspend/end transitions are versioned and auditable;
- no membership grants broader store scope than recorded.
**Actor responsibility envelope**
- `partner manager` — manages authorized team scope; forbidden: self-grant unauthorized stores/permissions.
- `member` — accepts/uses only granted scope; forbidden: infer broader access from role label.
- `Identity` — owns auth/session/permission binding; does not own DSH membership lifecycle.
**Surface semantics**
- `app-partner` and `control-panel` — required where membership management/readback is exposed.
- `backend` and `database` — required canonical membership/version/audit enforcement.
- technical presentation binding — implementation evidence only.
