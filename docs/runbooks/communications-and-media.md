# Communications and Media Recovery

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE

## Notification delivery incidents

First distinguish source-domain event truth from delivery failure. Confirm event/correlation identity, delivery policy/preferences, channel adapter and provider result.

- delayed/duplicate delivery: deduplicate by delivery identity where required; never duplicate the source business mutation;
- provider unavailable: retry according to channel policy/backoff or route through an allowed alternate channel only when semantics permit it;
- invalid destination: preserve source-domain state and surface a delivery failure/remediation state;
- native deep-link failure: repair app-host routing without treating provider delivery as failed business truth.

Unknown provider status remains unknown until reconciled when duplicate delivery/effect matters.

## Media/object-storage incidents

Separate owner-domain reference truth from binary storage transport.

For failed upload/reference commit, determine whether an orphan object or dangling reference exists and reconcile in the safe direction. For read/delete failures, re-check owner authorization and storage provenance before retrying.

Do not make a bucket/object URL authoritative business state, and do not expose private objects by default to simplify recovery.

## Closure

Verify canonical owner readback, delivery/media authorization, retry/dedup behavior, orphan cleanup where applicable and observability correlation without secret/PII leakage.
