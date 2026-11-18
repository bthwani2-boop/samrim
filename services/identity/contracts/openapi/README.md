# Identity OpenAPI — progressive owner-backed authentication and admission

STATUS: CONTRACT_IN_PROGRESS
EXECUTION: IN_PROGRESS

The canonical `identity.openapi.yaml` entrypoint links the health probe, two optional synthetic phone-proof operations, and five operations protected by Identity opaque bearers. Direct Merchant admission and re-entry require verified Customer proof and issue a short-lived Merchant bearer for that same actor.

The current effective-permission read checks a verified active Operator session and one explicitly stored active permission from the seven governance-approved scopes; `role=operator` alone is never sufficient. Any DSH consumer must verify current Identity state and then apply its **own** Store resource authorization. Finance scope is not blanket WLT execution authority.

The entrypoint links owner Path Items through local references. `paths/runtime.yaml` owns health, `paths/client-auth.yaml` owns synthetic phone proof, `paths/session.yaml` owns session read/logout, `paths/managed-enrollment-auth.yaml` owns direct Merchant admission/re-entry, and `paths/internal-actor-administration.yaml` owns the effective Operator permission read.

The original scaffold recorded “no server, no security scheme”. The current contract declares an opaque bearer scheme and leaves binding to the isolated runtime. The repository structure guard checks fragment ownership, not arbitrary OpenAPI validity.

Proof is in the owner-backend tests and isolated PostgreSQL readback, not a successful HTTP status by itself. Root policy: `governance/identity.md`.
