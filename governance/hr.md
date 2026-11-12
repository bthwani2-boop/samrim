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
