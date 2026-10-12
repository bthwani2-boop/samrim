# BThwani Employee HR (EMPLOYEE_HR)

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY
CAPABILITY_ID: EMPLOYEE_HR
SEMANTIC_OWNER: docs/governance/product/capabilities/access/employee-hr.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Actors and identity

A BThwani employee is a company employment relationship, whether the employee operates the Control Panel or works as non-operator staff. Staff/employee is not a high-level Identity role. Captains, field-acquisition representatives, Partners and Store staff are excluded unless an explicit, independently approved BThwani employment relationship exists. One employee record links to at most one canonical actor identity for operator access; no duplicate person account.

## Admission and operator privileges

An HR-authorized Operator can create and manage the employee directory and submit a request for Operator access. Only the canonical initial Operator can approve/reject access requests, grant or change Operator permissions, and issue/revoke Operator invitations. HR record creation never automatically admits an Operator or grants any workspace permissions. A new Operator profile must originate in an HR employee access request; the Control Panel cannot independently create or edit an Operator's employment data in Identity. Existing admitted legacy Operator profiles remain readable and manageable without being silently converted or deleted. Identity's actual role admission must be written back as the unique canonical employee-to-actor link before the new Operator receives an invitation; a failed cross-service writeback must be recoverable idempotently. Rejected access requests remain auditable; HR may correct the employee and submit a new request after rejection. A request already claimed for Identity creation cannot be rejected until an independently safe reconciliation path exists. Organizational department, title, reporting line and seniority have no implicit authorization effect.

## Employment data and privacy

The employee has one durable HR record with stable employment identifier, personal/work facts, job history, reporting line and start/end state. Non-operator staff can be recorded without a platform account. HR read and mutating privileges are scoped and independently enforced by backend authorization. Compensation, payout destinations and sensitive employment documents are not part of the general employee registry and require dedicated, narrower authority.

## Attendance, compensation and custody

When adopted, verified device attendance is evidence to HR scheduling/leave rules, not final salary deductions. Source events are attributable, idempotent, chronologically preserved and correctable only by audited adjustments; missing device data is not automatically absence. Biometric templates are not centrally copied as ordinary HR data.

HR owns employment terms and salary entitlement calculation; WLT exclusively owns financial posting, payout, external transfer and reconciliation. Salary payment reuses WLT controls where compatible but does not inherit Captain/Partner/Field earnings rules. No historical ledger or payroll approval is permanently deleted. Employee cash advances and equipment custody are distinct; WLT owns monetary advance settlement, HR owns issued equipment and returns.

## Experience and safe evolution

The Operator workspace includes an HR directory, with one employee creation flow and readback, and separate initial-Operator-only access administration. Show only relevant and authorized data; entering employees is not delayed by optional financial or biometric information. Deliver optional attendance, salary, payroll, device integration, equipment custody and audit projections in proven bounded slices; a planned capability is not a claim of current implementation.

### HR-requested versus Identity-granted permissions

The HR access request records recommended workspace permissions only. Those do not
enable any Identity permissions automatically. After Root Owner admits and links
the operator, the access review reads live Identity permission state and permits
Root Owner to explicitly approve or revoke only a subset of the permissions
proposed on that request, with an attributed reason. Identity's permission audit
is the authority for applied rights; HR request IDs are retained in reasons.
On partial failures, the review can be retried: each applied permission is
read back, and unchanged permission values are not written again. Permissions
outside the HR request are never changed by this review; they remain subject to
the separate canonical access-administration flow. A permission change revokes
the affected operator's existing Identity sessions.

Local development may keep direct Root Owner password login while exposing the
normal invite, passkey and recovery journeys for testing. These additional
options must never bypass the Identity enrollment token and challenge.


### Single employee; conditional operator access

Operator is not a separate HR employee category or a second person. Each
employee has exactly one HR record regardless of whether they can operate the
platform. The optional Identity operator role grants access to the Control Panel;
it does not define employment or create a second employment relationship.
Suspending the employee's operator role is a Root Owner decision using Identity's
existing role state, which revokes active operator sessions and pending
invitations but leaves the HR employee record and employment status unchanged.
Restoring this role is permitted only while the employee remains active.
The HR employee detail page reads Identity to show actual role status; a linked
actor ID alone must never be mistaken for currently enabled access.
Employment separation and historical record retention are separate HR lifecycle
work, not automatic consequences of removing an operational permission.

### Employment lifecycle and safe operator offboarding

Employment status is owned by HR; being an operator remains an optional Identity
role of the same employee. A linked operator must be disabled in Identity and
their sessions revoked before HR commits inactive status. Root Owner authorization
is required for linked employees; HR operators may change non-operator employees'
employment status. If Identity succeeds but HR is unavailable, the operator is
already safely disabled and the same attributed HR operation can be retried using
its idempotency key. Reopening employment does not restore operator access or
revoked sessions automatically. An active manager with active direct reports cannot
be marked inactive until those reports are reassigned. The audit retains the
employment decision reason and before/after HR facts. No identity or HR record is
deleted by this transition.


### HR employee audit readback

The employee detail view reads the existing append-only HR employee events,
including creation, changes to employment facts and changes to employment status.
Events are attributed to the acting operator with the original reason and
timestamp; the history is paginated without creating a second audit owner.
Only the existing HR read permission may read an employee's HR audit history.
Status changes retain before/after snapshots in the canonical store, while the
general employee interface displays only necessary audit metadata.
