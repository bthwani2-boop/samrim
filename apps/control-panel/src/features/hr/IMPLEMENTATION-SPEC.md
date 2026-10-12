# BThwani — Employee HR, Operator Admission, Attendance & Payroll Specification

**Current-source notice (12 October 2026):** This file originated as a phased design brief at
baseline e0f0fae8 and is *not* an authoritative live status report.
Current branch 14 contains HR-001 through HR-004, employee/Identity links, Root-governed
operator admission, employee status and history, and manual attendance candidate
migration 120 (subject to current-HEAD proof). The two original HR employees are
preserved. Passkey activation of the second linked operator, full leave approval,
confidential salary contracts, payroll/WLT payout, physical custody, biometric
devices, and advanced reporting are not claimed completed. Use the canonical
governance capability owner and current source/tests for implementation truth.

**Location:** Control Panel HR feature; outside governance. **Authority:** user approval and canonical service contracts prevail; this file is a future implementation brief, not production policy.
**Audit basis:** branch `14`, execution baseline `e0f0fae8a412cfb1965cf1cfdb780b7295c3f8d2` (2026-10-12). SQL migrations were verified in rollback-only transactions; production/runtime data remains unchanged, and no live end-to-end closure is claimed.
**Scope:** employees of BThwani only: operators and non-operator employees (e.g., security staff or cleaners). No captains, field acquisition representatives, partners, clients, or store employees are automatically part of this register.

## 1. Mandatory boundaries and terms

- **Employee / موظف:** a real person recorded in the BThwani HR register, with one stable `employee_id`. Employment is a business relationship, **NOT** a sixth Identity actor role. No login is implied.
- **Operator / مشغّل:** an existing Identity `operator` role admitted to the Control Panel. Normal employed operators link to exactly one HR employee record; preserve their canonical `actor_id`, role, profile, sessions, and permissions. One employee must not get two HR records because the role is admitted later.
- **Non-operator employee:** employee in HR with **no** operator account and no Control Panel access. Phone may be optional according to verified contact policy.
- **Root Owner / المشغّل الأساسي:** unique canonical initial operator. An explicitly HR-authorized operator may create BThwani employee records and propose operator access. Only the Root Owner may approve/admit an operator, issue invitations, manage operator permissions, and grant HR access. The protected Root Owner is not automatically presumed to be a salaried employee; link to an employee record only if an employment relationship is established.
- **Captains, field actors, partners, customers, stores and merchant staff:** never implicitly enrolled in HR via their Identity roles or WLT financial data. Do not merge their earnings/commissions with employee payroll. No new Identity `employee` role or employee-specific login system.
- **Department / قسم**, **job title / مسمى**, **direct manager / المسؤول المباشر**, **work location / موقع العمل**, **access permissions / الصلاحيات** are separate facts. Titles and management seniority never confer permissions. Prevent cyclic manager relationships and self-reporting. Employee management chain does not automatically reveal salaries.
- Any person who already has a canonical `actor_id` keeps it. Existing `identity_operator_profiles` and `identity_actor_roles` must not be replaced or duplicated.

## 2. Historical baseline observations (superseded for current implementation)

- `apps/control-panel/src/features/access/operator-profile-panel.tsx` creates operator pre-admission profiles with `fullNameAr`, `phoneE164`, `jobTitle`, `department`; profiles have pending-review, approved, admitted transitions.
- `apps/control-panel/app/api/access/operator-profiles/route.ts` and `services/identity/backend/internal/actor/operator_profiles.go` enforce operator-administrator privilege and preserve audit/idempotency; Identity `IsOperatorPermissionAdministrator` resolves the canonical initial operator.
- `services/identity/database/migrations/024_operator_profiles_and_review.sql` and `027_operator_role_details.sql`: current operator profiles/role display fields; `job_title` and `department` are strings, not organizational foreign keys.
- `apps/control-panel/src/session/operator-permissions.ts`: only operations, partners, catalog, marketing, finance and platform_policies exist. HR is not currently one of the workspace permissions.
- `apps/control-panel/src/navigation/workspace-registry.ts`: no HR destination. Existing /access is marked initial-operator-admin-only.
- No canonical HR employee/attendance/salary/payroll implementation was identified in the inspected Control Panel, Identity and WLT source; absence requires repository-wide and database verification before implementing.
- User screenshot of `/access`: inline operator-creation form competes with directory/table and leaves unproductive whitespace. This is a UX deficiency, not reason to redesign Identity.

## 3. HR-authorized creation flow — one coherent entry

Location: **الموارد البشرية** (authorized HR operators and Root Owner); one employee form. **الوصول والصلاحيات** is Root Owner-only and receives access requests. HR users cannot issue live access invitations.

An HR-authorized operator chooses **إضافة موظف** and creates one employee record. No 'operator versus staff' choice: Operator access is a separate later decision. Do not derive Identity roles from the employee form or duplicate actor onboarding.
**First step: minimal required entry**
1. Arabic full name (required; 2–120 characters; verify normalized and prevent duplicate active person records without relying only on phone).
2. One employee category for all staff; no operator/staff classification is stored as an employment kind. The optional linked Identity `operator` role is a separate access relationship.
3. Department selected from a small controlled directory; initial allowed defaults map to existing sections plus Administration/HR/Support as justified, and no unlimited taxonomy.
4. Job title selected/suggested within department; allow Root controlled new title without granting capabilities.
5. Direct manager: existing active employee, optional for Root/top of hierarchy; enforce no self/cyclic relation.
6. Start date and work location / city (required when applicable; local date and timezone).
7. Contact phone: optional for HR entry. Required and verified separately if an Operator access request proceeds to Identity admission.
8. Employment status initially **pending / active** per approved employment effective date; no automatically active system access.

**Follow-up, not mandatory in initial entry:** staff ID documentation, emergency contact, work schedule, salary terms, optional supporting documents. Do not demand photos, address, bank details, biometrics or identity scans just to create a minimal record. Add only under approved, access-controlled necessity.

**Later access-request handoff:** HR submits a request to the initial Operator for approval; only the initial Operator creates/reuses the existing Identity `operator_profiles` admission flow (review → approval → grant role → invitation → activate). Start with **no workspace permissions**. Link the employee record to the canonical operator actor/profile without split-brain partial creations: deterministic retry and reconciliation, conflict handling, no duplicate employee/actor records. Deactivation preserves employment and history.
**Non-operator handoff:** save employee only; **never** create an Identity actor, login credentials, invitation or role.

## 4. Employee profile (data visibility by permission)

- **Overview:** name, employee ID, employment status, operator badge (if applicable), department, title, manager, location, start date. Clear edit history.
- **Employment:** effective-dated department/title/manager/location, employment type, end-of-employment status/reason, tenure; never destructive delete historical agreements.
- **Attendance:** assigned work schedule and holidays, dated presence/absence/late/leave, time entries and corrections, evidence/source, approver. Show only after implemented.
- **Compensation:** current salary agreement and currency/period, effective date and prior changes; **visible only to authorized compensation viewers**, not all HR, managers or operators. Wage terms must not appear in Identity claims, generic operator list, or broad HR search responses.
- **Payroll (later):** period, approved timesheet/leave inputs, earned/deducted components, payslip, disbursement status and reconciliation link. No early 'payment successful' claim before authoritative WLT/finance readback.
- **Operator access (Root only):** Identity actor, role activation, sections, permissions, access history, security status. HR personnel without Root authority cannot assign, invite, revoke or change operator access.

UI: directory with searchable filters and manageable table, compact row actions, operator type badge, optional employee-detail side panel/dialog; use a focused create form (roughly 560–720px max width) with responsive two-column grouping on desktop and single column on mobile; preserve RTL, keyboard navigation, error summaries, autosave only if proven safe. Avoid page-width buttons and forms. No decorative dashboard overload.

## 5. Authorization and supervision

- Creating employee HR records: authorized HR operators or Root Owner. Granting operator roles/permissions and controlling access to /access: **Root Owner only**, enforced on the server-side owner and in Control Panel BFF; forbidden calls return 403 even when requests bypass the UI.
- HR access is a **separate, explicit permission**; add it to existing operator entitlement infrastructure instead of a new Identity role. By default no one receives HR permission except Root unless explicitly delegated.
- Within HR distinguish at least **read HR core**, **manage attendance**, and **read/manage compensation** as necessary. Do not derive compensation visibility from an HR section toggle alone. Prefer policy-backed capabilities within HR rather than inventing many unrelated top-level privileges.
- An authorized non-Root HR operator may create and manage employee records and attendance, but cannot activate operator access. Root-only modifications to salary agreements at first; later consider independently approved HR compensation proposal if demonstrated necessary.
- Administrative oversight is bounded by manager/team/scope and action; higher organizational seniority never automatically inherits authorization or payroll access. Root sees all HR activity under authorized audit views; immutable audit cannot be removed by UI users.
- Deductions, allowances, payout approvals and personal banking/payment destinations require stricter, separate authorization; no self-approval and no financial historical deletion.
- The employee record is never erased by disabling operator access or recording departure; revoke operator sessions/role access using Identity's owner while keeping HR and financial history.

## 6. Attendance — phase after canonical employee foundation

- Do **not** treat operator login time as attendance. Do **not** infer the absence of login as absence, especially for cleaners/guards.
- Support flexible roster/shift with effective dates, weekly off days, holidays, night shifts and overnight midnight crossing. Configure from employer rules, do not hardcode Yemen working hours/holidays/pay rates.
- Start with **manual attendance recording by authorized HR**, with date, employee, present/absent/leave/late status, optional check-in/out times, note and actor/time audit. Later add employee self check-in ONLY if actual access channel and anti-fraud need are proven; do not force non-operator accounts.
- Missing attendance is **unknown/not reported**, not automatically unpaid absence. Late/absence classification must consider leave and schedules. Corrections append an auditable event and retain previous values; month close prevents silent rewrite.
- Approved leave, sick days, overtime, holidays and policy exceptions require explicit definitions before deductions/payouts. Do not use tracking, continuous GPS, camera, fingerprints, or biometric capture by default.

## 7. Compensation and payroll — separate safe phases

- Initial salary fact: effective-dated contract terms (gross/basic amount as applicable, ISO currency, pay period monthly/daily/hourly, allowances if necessary, valid-from, authorized changer and reason). Monetary values stored as integer minor units with defined currency precision; never floats. Preserve historical salary changes and readback; no overwrite of prior agreed rates.
- Do not require salary in the very first operator-account form. Compensation may be completed securely after the employee record exists, by Root or an explicitly approved process.
- Employee salary is **not** a wallet balance, captain/field incentive, partner settlement, or manual WLT transfer. Separate HR payroll calculation from WLT authoritative payments, ledger and settlement. Do not launch payroll transfers just because a salary term exists.
- Payroll phase: compute a period from **approved** salary terms + schedule/attendance/leave + approved adjustments; render draft for review, freeze approved statement/payslip, send one idempotent authorized payout instruction to the proper finance owner, reconcile status. Use compensating entries and audit for corrections; never erase payroll/ledger facts.
- Finalize jurisdiction-specific labor rules, employee classification, currency, overtime, deductions, holidays, wage receipt, privacy/retention and tax obligations with local legal/finance review before automatic payroll. Do not assume current commercial WLT permissions authorize viewing employees' salaries.
- Access to salary, payout destination and HR documents must be minimal, explicitly scoped, non-cached, audited and redacted from unrelated logs/notifications.

## 8. Implementation order / minimal releases

**NEXT — Slice HR-001 Employee identity & directory (first engineering work after approval):**
- Establish one canonical HR employee owner and durable employee ID with optional unique operator `actor_id` link; name/department/title/manager/status/location/start-date; immutable event audit; safe unique/migration/upgrade handling.
- Reuse existing operator Identity admission, including protected Root Owner bootstrap, without changing the five high-level actor roles or creating accounts for non-operators.
- Add top-level `الموارد البشرية` to Control Panel, employee directory and employee detail/overview; HR-authorized add employee action in `الموارد البشرية`, and link employee↔operator; HR-specific server permission for authorized read.
- Audit current active operators and map them safely to exactly one employee if they are genuine BThwani employees. Never auto-create payroll/HR records for root merely because root exists or for captain/field actors. Backfill only from verified facts; unverified mappings need Root confirmation.
- Align the current inline create form with deliberate entry UI, and preserve existing working operator flow. No salary/attendance mutations yet.

**SOON — Slice HR-002 Attendance:** schedules, authorized manual daily attendance, absence/leave states, evidence, historical corrections, manager read scope, monthly read-only summary. Do not generate salary deductions without approved policies.

**SOON — Slice HR-003 Confidential compensation:** salary contract terms with effective dates, restricted salary profile tab, history/audit, nonoperator as well as operator employee support; explicit HR/finance owner separation; read-only period preview only.

**LATER — Slice HR-004 Payroll:** approved leave, overtime, allowances/deductions, monthly locked payroll/payslips, finance/WLT booking and payment reconciliation, independent approval, cancellation/adjustment history. Add localized statutory computations only after verified requirements.

**LATER — Slice HR-005 Supervision and recycle-bin audit:** manager/team activity projections, recoverable changes, sensitive operations with review, root audit across operators; never delete ledger/payout/payroll/identity audit.

Avoid building a new employee-facing mobile application, a new Identity role, a second login for guards, a full ERP, a new service/runtime, biometric time clocks, recruitment portal, or automated wage engine in HR-001.

## 9. Owner/correctness gates before implementation

- **Architecture gate:** confirm canonical HR ownership and schema under existing backend runtime; avoid placing authoritative HR employee data in Next.js BFF, Identity authentication tables or WLT ledgers. Separate HR logical schema/module; no deployment/microservice until warranted. Existing product's actual ownership contract must be reviewed before finalizing physical placement.
- **Source audit:** inspect HR collisions (if work landed since this spec), current operator journey and role migration, finance API boundaries, security policy, dataset preserving migration and upgrade path. User has other unrelated uncommitted runtime changes; preserve them.
- **Role-boundary denial tests:** non-HR operator fails employee creation; authorized HR operator can create an employee but cannot grant roles/invitations/permissions; only Root may administer Operator access, including against forged client headers.
- **Employee identity:** one existing admitted operator ↔ one employee; existing identities/sessions intact; re-run after timeout does not duplicate; nonoperator has no actor/account; field/captain not imported; organizational graph has no cycles.
- **Data privacy:** generic employee directory never returns salary/payment destination; HR read without compensation permission cannot access wage values via deep link, API, export or search; manager cannot inherit HR finance authority; no secret/PII in app logs.
- **Attendance/payroll proofs (when their phases ship):** cross-midnight shift, weekend/holiday, leave, ambiguous/missing records, concurrent approvals, rejected duplicates, old wage effective date, salary correction after lock, no double payout.
- **UI proof:** Arabic RTL and accessibility, keyboard/mobile/desktop, no full-width giant controls, clear errors/retry, empty/loading/conflict states, employee details visible and permissions consistent.
- **Persistent protection:** no manual DB resets; migrate existing users and history safely, use isolated disposable tests; verify canonical backend readback. No unrelated branch/file modification; commit/push only when expressly authorized.

## 10. Why this scope (external references — research only)

- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Authorization Patterns: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Patterns_Cheat_Sheet.html
- Frappe HR (open source): https://github.com/frappe/hrms
- Frappe HR Payroll Setup: https://docs.frappe.io/hr/payroll-setup
- OrangeHRM open-source feature overview: https://orangehrm.com/open-source/open-source-on-demand

**Research outcome:** borrow employee directory → attendance/leave → salary terms → payroll separation, not the whole third-party HR stack. This specification has **no executable implementation** and is intentionally outside `docs/governance`. Changes to approved Product/security/architecture meaning must still go through proper owner approval at implementation time.
