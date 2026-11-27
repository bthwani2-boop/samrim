# Merchant registration recovery and Arabic input

Derived increment of PARTNER_ONBOARDING_STORE_PUBLICATION. Canonical authority: [stores](../../governance/stores.md), [experience](../../governance/experience.md) and DSH merchant-registration contract.

## User story and acceptance

- AC1: If a Store was committed but its response lost, same-operation replay may return the current already-published Store. Merchant refreshes the Store list and clears pending metadata. No second Store or client publication action.
- AC2: A fresh registration claiming published=true is an unknown/invalid result and retains retry metadata.
- AC3: Arabic-Indic and Eastern Arabic-Indic digits with Arabic decimal separator normalize to the same decimal coordinates and replay fingerprint as ASCII. Reject invalid/nondecimal coordinates, names exceeding owner limits and control characters before transmission or new metadata persistence.
- AC4: Preserve existing Identity/DSH scope, policy, consent, idempotency and private recovery metadata. Verify Web and Android, BFF and actual owner readback using authorized isolated runtime; no whole-journey acceptance without required proof.
- AC5: Recovery after original registration policy removal or supersession requires scoped owner command readback or equivalent verified owner mechanism. Do not infer success from Store-list similarity or persist private payload in Web localStorage.

No new writer, grant, SQL, policy or external activation is implied. Actual implementation/acceptance remains with the owner.
