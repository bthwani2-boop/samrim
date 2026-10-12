# BThwani Employee HR (EMPLOYEE_HR)

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY
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
