# Identity OpenAPI — progressive owner-backed authentication and admission

STATUS: CONTRACT_IN_PROGRESS
EXECUTION: IN_PROGRESS
PRODUCTION_ACTIVATION: BLOCKED

The canonical `identity.openapi.yaml` OpenAPI 3.1.0 entrypoint now links exactly four **isolated development** operations through three local Path Item references: `GET/DELETE /v1/sessions/current`, `GET /v1/operators/me/permissions/{permission}`, and `POST /v1/actors/me/merchant-role`. All require an existing Identity opaque bearer; the Merchant admission command requires separately proven Customer verification and issues a new short-lived Merchant bearer for that same actor only. There is no `servers` declaration, first-factor login, Passkey issuance, Operator bootstrap, permission grant mutation, Store grant or production endpoint.

The current effective-permission read checks a verified active Operator session and one explicitly stored active permission from the seven governance-approved scopes; `role=operator` alone is never sufficient. Any DSH consumer must verify current Identity state and then apply its **own** Store resource authorization. Finance scope is not blanket WLT execution authority.

The original scaffold label **no server, no security scheme** was historical and is no longer a description of this admitted read contract. Previous scaffold wording describing `paths: {}` and no security scheme is historical only; the contract now intentionally includes security-dependent reads and bounded isolated Identity owner writes. The three admitted Path Items are authored exactly once: `paths/session.yaml` owns GET/DELETE session, `paths/managed-enrollment-auth.yaml` owns POST verified Customer to Merchant, and `paths/internal-actor-administration.yaml` owns GET effective Operator permission. The entrypoint only references these Path Items with local `$ref`; each fragment references shared component schemas relative to its parent entrypoint. The four unrelated reserved path groups remain empty and unimplemented. This is one executable contract graph, not duplicate API catalogs. The stage guard is **not arbitrary OpenAPI validity**; it checks local path-group linking and scope but alone does not prove protected authentication, generated client parity, SQL readback or a real operating journey.

Proof is in the owner-backend tests and isolated PostgreSQL readback, not a successful HTTP status by itself. Root policy: `governance/identity.md`.
