# Native Customer Wallet — Bounded history continuation

Derived CUSTOMER_BALANCE_FUNDING and IDENTITY_ACTIVATION_SESSIONS scope. Authority: [finance](../../governance/finance.md), [identity](../../governance/identity.md), [safety](../../governance/safety.md). No new business policy.

## User story and acceptance

An authorized Customer reading older funding transactions recovers from a stalled read without indefinitely blocking foreground verification or retry.

- AC1: Stalled continuation releases its own pending state within the existing 12-second refresh budget even if transport ignores cancellation. Foreground polling resumes and authorized retry is possible.
- AC2: Late response after timeout, blur, sign-out, replacement or expiry cannot append history, extend validity or clear newer pending state. Denial, actor change or expiry conceals private data; cancel owned timer on settlement.
- AC3: Preserve exact YER, cursor, deduplication, same-actor foreground refresh, retry, background concealment and owner verification.
- AC4: Verify stalled/noncooperative read, late success, retry/lifecycle, existing tests, uncached type/lint, actual authenticated Android synthetic owner read and applicable privacy/finance assessment.
- AC5: No WLT write, contract change, new grant/dependency, policy setting or activation.
- AC6: Pre-aborted Identity read dispatches nothing. Stalled fetch/header/body settles promptly even if transport ignores abort. Late reply cannot identify actor or invalidate replacement bearer.
- AC7: Subsequent valid role read proceeds independently; late completion/rejection cannot be unhandled; remove listeners on settlement.
- AC8: Dispatched POST/PATCH/DELETE cancellation remains OPERATION_RESULT_UNKNOWN; no blind retry, invented success or duplicate refresh. Preserve rotation handoff/quarantine in readPersistentIdentityRole; no owner API, DB, grant or credential change.
- AC9: Verify shared Identity transport and Customer/Merchant/Captain consumers, cancellation, rotation, positive/negative tests, type/lint and runtime.

Use the existing 12000 ms technical deadline, not operator-editable policy. Preserve only confirmed unexpired display on timeout; never extend validity or introduce a second polling/data engine. WLT owns money. Actual acceptance/evidence belong to the canonical work source.
