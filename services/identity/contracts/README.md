# Identity Contracts

`identity.openapi.yaml` is the sole current Identity wire-contract authority.

It preserves: one `actor_id`, explicit actor↔role binding, single-role sessions, OTP authentication for client/partner/captain/field, password authentication for operator, and credential-derived internal service identity.

Forbidden residue includes caller/context trust headers, consumer-authored actor IDs, generic grant/tenant/context objects, operator OTP, actor-global role arrays/permissions and obsolete governed-activation issuance routes.

Generated client lineage must be deterministic from this contract.
