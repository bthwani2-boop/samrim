# Identity Contracts

`identity.openapi.yaml` is the sole current Identity wire-contract authority.

It preserves:

- one permanent `actor_id`;
- phone as a mutable verified identifier rather than the primary identity;
- explicit actor↔role bindings and single-role sessions;
- customer phone-verification + client-password registration/login/recovery;
- one-time managed partner/captain/field activation after governed provisioning;
- explicit DSH-authorized managed-role re-enrollment;
- operator password proof plus a required second-factor challenge before session creation;
- credential-derived internal service identity.

Forbidden residue includes universal OTP login, repeated managed activation as ordinary login, password-only operator sessions, username as a mandatory Identity convention, caller/context trust headers, consumer-authored actor IDs, generic grant/tenant/context objects and actor-global role arrays/permissions.

Generated client lineage is deterministic from this contract.
