# Identity Contracts

`openapi/identity.openapi.yaml` is the sole current Identity wire-contract authority. Its declared path modules are the only authored contract sources; generated clients are derived outputs.

It preserves:

- one permanent `actor_id`;
- phone as a mutable verified identifier rather than the primary identity;
- explicit actor↔role bindings and single-role sessions;
- customer phone-verification + client-password registration/login/recovery;
- one-time partner/captain/field activation after their domain-owned admission;
- explicit actor_id-addressed Control Panel authorization for managed-role re-enrollment;
- user-verified, discoverable Operator WebAuthn/Passkey authentication and governed re-enrollment;
- credential-derived internal service identity.

Forbidden residue includes universal OTP login, repeated managed activation as ordinary login, Operator password/SMS normal-login fallback, username as a mandatory Identity convention, caller/context trust headers, consumer-authored actor IDs, generic grant/tenant/context objects and actor-global role arrays/permissions.

Generated client lineage is deterministic from this contract.
