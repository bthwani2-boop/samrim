# BThwani — Bounded Employee Administration

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/hr.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## EMPLOYEE_HR — Employee records and approved workplace duties
CAPABILITY_ID: EMPLOYEE_HR

**Purpose:** One bounded DSH `employees` engine may manage approved employment records for both BThwani company staff and each Merchant's staff: organizational ownership, optional links to the one Identity actor, job/department assignments, employment documents and individually admitted attendance or custody workflows. A Merchant employment record is not a BThwani company employment record. No fourth service, parallel Merchant HR engine, generic payroll or globally privileged employee role is admitted by this placement decision.

DSH owns approved employee facts and the single bounded HR implementation; Identity owns the human account, sessions and platform permissions; DSH separately owns Store membership/delegated permissions and operational actions; WLT alone owns financial postings. An employee may have no platform account, or may have one Identity actor linked to assignments across multiple authorized Stores without duplicate identities. Creating employment, assigning a department or associating a Store **never** grants platform or Store access automatically.

BThwani personnel data and each Merchant's personnel data require separate organizational scopes, least-privilege company/Store permissions, privacy-safe audit, lawful retention and safe separation. An authorized Merchant may administer only their eligible organization/Store staff under DSH grants; company HR Operators require explicit Identity scopes. No cross-Merchant or Merchant-to-company employee visibility is implied. Operator/Merchant screens invoke DSH rather than writing a second employment registry.

Attendance and compensation are independently admitted when required and legally supported; do not invent payroll, generic ERP, unrestricted personnel tracking, or financial writer from historic spreadsheets or screenshots.

**Recovery/proof:** Two employee accounts with different rights, revoked role, historical employment event, attachment/PII boundaries, failed write, idempotent retry and exact owner readback. Do not confuse a working HR card with payroll readiness.

## Employee admission versus Operator identity

Employment lifecycle and account/role lifecycle are separate. An authorized HR Operator may request Operator access for an eligible employee, but the **initial bootstrapped privileged Operator** owns normal Operator-admission approval and scoped permission grants under the current protected Identity policy. An employee may have no platform account; merely being a Captain or Merchant actor does not establish employment. A Store employee is staff of the specific Merchant organization when explicitly appointed, not automatically BThwani company staff. Existing employee Identity is reused, never duplicated under an HR-only login table.

DSH holds authorized employee employment terms, attendance, documents and relevant custody with organization-scoped history; WLT alone records authorized actual money movements and reconciled liabilities. No global Merchant payroll or unapproved company compensation writer is introduced. A designation or department cannot grant Finance, Store, Captain dispatch or Root Owner privileges. Private HR media/documents are not public marketing assets.

## HR access-review and employee lifecycle safety

An HR-authorized employee record may be created without a platform login. An HR employee access request contains *proposed* Operator permissions only; only the protected initial privileged Operator can approve the request and grant an explicit subset through Identity. HR does not write Identity permissions. Partial Identity-to-HR cross-owner admission must be resumable from an operation identity without duplicate actors or silently losing a reviewed rejection. Root Owner direct-development access does not relax production passkey/enrollment constraints.

The initial manual attendance flow distinguishes explicit presence, absence, lateness and leave **annotations**. An unrecorded day is **unknown, not absent**. A correction requires expected record version, reason and append-only attributable HR event. Overnight intervals may be recorded, but attendance and biometric evidence are not automatic salary deductions or leave approvals. DSH owns approved employment terms and entitlement, WLT owns actual financial posting/settlement, and equipment custody and cash advance are distinct obligations.

When ending employment of an active employee with Operator access, Identity must first disable that role and revoke sessions/invitations, then HR marks employment inactive with attributable replay-safe write. If the second owner is unavailable, keep the user safely disabled and reconcile HR later; **restarting employment never restores old privileges automatically**. An active manager with reports cannot leave active management until reporting relationships are resolved. Preserve employee record history without deleting old personal or accounting facts merely to clean a directory.
