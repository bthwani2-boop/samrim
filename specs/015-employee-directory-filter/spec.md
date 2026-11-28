# Employee directory — Recorded employment end-date filter

Derived EMPLOYEE_HR scope under [HR](../../governance/hr.md) and [safety](../../governance/safety.md). Existing company HR grants and Merchant employer scopes remain unchanged.

- AC1: Optional endState=NO_END_DATE or HAS_END_DATE on both employee list routes; absent means all. Reject unsupported, duplicate, empty, unknown and mixed detail/mutation selectors. A recorded date does not infer active/terminated status.
- AC2: DSH filters inside verified employer transaction before 30+1 cursor paging; stable UUID order, no cross-employer disclosure/writes, unchanged expiry/revocation.
- AC3: Existing SDK verifies returned endDate against requested filter; preserve continuation, unfiltered callers and no-store.
- AC4: Operator/Merchant expose explicit labels, reset paging on filter change, preserve filter on continuation/refresh, hide denied/stale data. No automatic permission or lifecycle change.
- AC5: Real isolated PostgreSQL positive/negative, 31-row boundary and two employer scopes, SDK/BFF/app, type/lint, contract and exact source/CI; authenticated runtime and applicable privacy/authorization assessment.

Employment admission/termination and Identity role/session/invitation changes are separate protected owner operations.
