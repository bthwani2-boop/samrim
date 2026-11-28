# Feature specification — Accessible mobile appearance selection

Derived scope: DESIGN-01, existing appearance capability. Canonical authority: [experience](../../governance/experience.md) and [platform](../../governance/platform.md). No separate policy or claim of implementation acceptance.

## User scenarios

A verified Merchant opens More and chooses system, light or dark. Customer and Captain have corresponding account settings on their admitted surfaces. The existing appearance preference persists, and an unsuccessful save is reported rather than claimed as success.

## Acceptance criteria

- AC-01: Merchant More and Customer/Captain account paths reach the preference control on their admitted Web/native surfaces, without opening a protected route or changing grants.
- AC-02: Three Arabic-labelled radio options expose exactly one checked state, including explicit false for the other two. Web keyboard navigation and focus follow radio-group semantics; Android checked/disabled semantics remain equivalent.
- AC-03: Before restoration and during a pending save, additional writes are prevented. Success persists through the existing controller; failure restores the last confirmed preference, presents retry and restores appropriate focus. Late responses must not overwrite a newer preference.
- AC-04: Verify reachability, selection, keyboard interaction, pending/failure/retry, storage and reload through actual applicable renderer/device checks, existing owner tests and source verification. Historical tests do not certify current runtime.
- AC-05: No additional appearance writer, theme provider, Identity/DSH/WLT API, SQL, permission, money or registered device identity change. Other Merchant capabilities and journeys have separate acceptance.
