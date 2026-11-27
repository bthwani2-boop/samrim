# BThwani — Bounded Employee Administration

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/hr.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## EMPLOYEE_HR — Employee records and approved workplace duties
CAPABILITY_ID: EMPLOYEE_HR

One DSH employees engine owns authorized company and Merchant employment records: organization, optional canonical Identity actor link, job/department, reporting line, documents, start/end and admitted attendance/custody. No fourth service, separate Merchant HR registry, global employee privilege or generic payroll. Identity owns accounts/roles/sessions; DSH Store grants are separate; WLT alone posts monetary effects.

Each stable employee ID belongs to one explicitly verified employer; manager must be active in that organization. One person may have separate lawful employment relationships with different organizations and one canonical Identity actor. Record links to at most one such actor, optionally none. Store affiliation is not employer or permission. HR contact phone may be absent, and enrollment phone requires Identity verification; no globally unique contact/actor shortcut that merges employer histories. Retained historical identity/uniqueness migration needs actual compatible protected review.

Company and each Merchant HR are isolated; authorized Merchant manages only eligible organization/Store staff under DSH grants; company HR requires explicit Identity scope. Title, department, Captain/Merchant role or employment never grants Store, dispatch, Finance, Operator or Root Owner authority. Private attachments and audit read obey current scope, not public marketing. No independent HR login, frontend rules engine or cross-organization data leakage.

### Registration and interrupted operation recovery

Approved 2026-11-25: company and Merchant registration use the same public DSH client protocol for normalized validation, operation identity, opaque recovery, serialized claims, identical-request replay and outcome classification. Distinct authorized routes and Identity checks remain. Apps own only platform presentation, storage/crypto/lock adapter and authenticated transport. Namespace distinguishes verified actor and employer (company vs Merchant), not individual Store affiliation.

Before transmission persist operation identity and payload fingerprint, not raw employee fields/bearer. Denial, conflict or uncertainty never authorizes a replacement unresolved identity; same authorized actor re-enters original values. Confirmed or definitive initial rejection may settle attempt; retain one opaque last-generation marker against stale concurrent tabs. Storage/lock failure blocks new submission. Local recovery metadata is no employee/permission truth; actual DSH authorization, immutable replay and durable owner readback decide outcome.

## Employee admission versus Operator identity

An HR Operator may submit an access request only for an eligible company employee. Actual Operator admission, invitation and permission authority belongs to [Identity](identity.md#operator-authentication-and-policy-control-admission), specifically the protected initial privileged Operator, not HR or Merchant Store grant. A new Operator originates in canonical DSH HR access request; preserve lawfully admitted legacy accounts and no relaxation of passkey/enrollment through direct-development access.

Request records proposing company employment scope, proposed permission subset and immutable submission-time name, verified contact claim, department and job snapshot. Later edits cannot rewrite it or expand granted permissions. Non-login employee without verified phone remains legitimate but HR contact alone cannot issue invitation. Initial protected Operator approves or rejects, issues/revokes invitation and grants selected authorized subset through Identity. Rejected request stays auditable and may be corrected/resubmitted; one claimed for Identity actor creation cannot be rejected without resolving partial effect. Link same employee to canonical actor only after actual Identity readback; replay writeback by one operation identity, never duplicate actor or lose rejection.

Review uses live Identity permission readback; preserve unrelated grants, don't rewrite unchanged permission on retry, revoke affected sessions after real change. HR request ID is correlation, not authority. Role suspension does not end employment; reinstatement requires protected Identity authorization and active employee. Linked actor does not prove enabled Control Panel. Operator uses one DSH HR directory/creation/readback, not second Identity employee editor.

## Employment lifecycle, attendance and custody

Manual attendance distinguishes explicit presence, absence, lateness and leave annotation; unknown/unrecorded day is not absent. Leave annotation is not approval or payroll. Correction requires expected version, reason, attributable append-only event. Overnight intervals allowed; biometric/device evidence optional, no ordinary HR biometric template copies or automatic salary deductions. Attendance and compensation require admitted lawful scope. DSH owns employment terms, entitlement and physical equipment issue/return, WLT actual monetary disbursement, cash advance reconciliation and liabilities. Salary is not Captain/Merchant earnings. No generic payroll/ERP or speculative personnel tracking; retain historical payroll/ledger rights.

History is append-only attributed, reasoned and timestamped; current HR read scope alone admits bounded paginated audit, with no general-directory exposure of compensation destinations, private attachments or unrelated organizations. Lawful retention and protected deletion follow safety.

End employment for active Operator only after protected initial Operator/Root Owner authorizes Identity role disable, session/invitation revocation and durable readback; then DSH marks inactive with replay-safe attributed transition. If DSH unavailable keep actor safely disabled and reconcile later. HR-authorized Operator can deactivate only non-Operator under admitted policy. Active manager with reports cannot leave management until relationships resolved. Reactivation of employment never restores old privileges automatically. Preserve original record and prior state/accounting; same owner append-only before/after audit, not second ledger.

## Acceptance

Prove two employers and actors, cross-Merchant/company employee IDOR denial, same-employer manager relationship, no Store-staff Operator admission, former-session audit denial, immutable request, revoked grant, historical event, attachment/PII boundary, concurrent and interrupted registration/replay, unknown recovery, access review and durable Identity/DSH readback. Actual role disable and session revocation precede HR end-state. Employee ID/phone, source-only or HR card is not authority or runtime proof. WLT actual payroll/financial activation needs its separate ledger and legal acceptance.
