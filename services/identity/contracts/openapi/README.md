# Identity OpenAPI — progressive owner-backed reads

STATUS: CONTRACT_IN_PROGRESS
EXECUTION: IN_PROGRESS
PRODUCTION_ACTIVATION: BLOCKED

The canonical `identity.openapi.yaml` OpenAPI 3.1.0 entrypoint declares exactly two **isolated development** read operations: `GET /v1/sessions/current` and `GET /v1/operators/me/permissions/{permission}`. Both require Identity-issued opaque bearer credentials; there is no `servers` declaration, login, Passkey issuance, Operator bootstrap, grant mutation, or production endpoint.

The current effective-permission read checks a verified active Operator session and one explicitly stored active permission from the seven governance-approved scopes; `role=operator` alone is never sufficient. Any DSH consumer must verify current Identity state and then apply its **own** Store resource authorization. Finance scope is not blanket WLT execution authority.

The original scaffold label **no server, no security scheme** was historical and is no longer a description of this admitted read contract. Previous scaffold wording describing `paths: {}` and no security scheme is historical only; the contract now intentionally includes read-only security-dependent operations. Reserved `paths/*.yaml` fragments remain empty and unreferenced. The stage guard is **not arbitrary OpenAPI validity**; structural checks do not prove protected authentication, generated client parity, SQL readback or a real operating journey.

Proof is in the owner-backend tests and isolated PostgreSQL readback, not a successful HTTP status by itself. Root policy: `governance/identity.md`.
