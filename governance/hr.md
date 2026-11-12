# BThwani — Bounded Internal HR

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/hr.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## EMPLOYEE_HR — Employee records and approved workplace duties
CAPABILITY_ID: EMPLOYEE_HR

**Purpose:** BThwani may manage bounded internal employee identity linkage, job/department assignments, employment documents, attendance and legitimately admitted compensation/custody workflows without creating a parallel Identity actor registry or globally privileged employee role.

Identity owns the human account and actual platform permissions; HR owns approved employment facts; DSH owns Store/Order/Captain operational actions; WLT owns money and ledger effects. A new employee does not inherit root platform powers, a Store merchant role or customer financial access merely from HR classification.

HR access and sensitive compensation/documents require explicit least-privilege Operator authorization, privacy-safe audit, limited retention and safe employee separation. Operator HR screen must invoke the canonical owner; HR is a **logical bounded capability**, not automatic authority to deploy a new service.

Attendance and compensation are independently admitted when required and legally supported; do not invent payroll, generic ERP, unrestricted personnel tracking, or financial writer from historic spreadsheets or screenshots.

**Recovery/proof:** Two employee accounts with different rights, revoked role, historical employment event, attachment/PII boundaries, failed write, idempotent retry and exact owner readback. Do not confuse a working HR card with payroll readiness.

## Employee admission versus Operator identity

Employment lifecycle and account/role lifecycle are separate. An authorized HR Operator may request Operator access for an eligible employee, but the **initial bootstrapped privileged Operator** owns normal Operator-admission approval and scoped permission grants under the current protected Identity policy. An employee may have no platform account; a platform Captain, Merchant or Store employee is not BThwani HR staff merely by participating. Existing employee Identity is reused, never duplicated under an HR-only login table.

HR stores sensitive employee salary, attendance, employment documentation and applicable custody with its proper owner and confidential history; WLT alone records authorized actual money movements and reconciled liabilities. A designation or department cannot grant Finance, Store, Captain dispatch or Root Owner privileges. Private HR media/documents are not public marketing assets.

## HR access-review and employee lifecycle safety

An HR-authorized employee record may be created without a platform login. An HR employee access request contains *proposed* Operator permissions only; only the protected initial privileged Operator can approve the request and grant an explicit subset through Identity. HR does not write Identity permissions. Partial Identity-to-HR cross-owner admission must be resumable from an operation identity without duplicate actors or silently losing a reviewed rejection. Root Owner direct-development access does not relax production passkey/enrollment constraints.

The initial manual attendance flow distinguishes explicit presence, absence, lateness and leave **annotations**. An unrecorded day is **unknown, not absent**. A correction requires expected record version, reason and append-only attributable HR event. Overnight intervals may be recorded, but attendance and biometric evidence are not automatic salary deductions or leave approvals. HR owns employment terms and entitlement, WLT owns actual financial posting/settlement, and equipment custody and cash advance are distinct obligations.

When ending employment of an active employee with Operator access, Identity must first disable that role and revoke sessions/invitations, then HR marks employment inactive with attributable replay-safe write. If the second owner is unavailable, keep the user safely disabled and reconcile HR later; **restarting employment never restores old privileges automatically**. An active manager with reports cannot leave active management until reporting relationships are resolved. Preserve employee record history without deleting old personal or accounting facts merely to clean a directory.
