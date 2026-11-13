# Identity OpenAPI contract scaffold

STATUS: CONTRACT_SCAFFOLD_ONLY
SEMANTIC_OWNER: Identity
EXECUTION: NOT_STARTED

The sole entrypoint is `identity.openapi.yaml` (OpenAPI 3.1.0). It deliberately declares `paths: {}`, no server, no security scheme and no production implementation. Its `info.version: 0.0.0` denotes a **placeholder**, not a published API version.

The seven domain-grouped, zero-operation `paths/*.yaml` reservations are `runtime`, `client-auth`, `managed-enrollment-auth`, `operator-passkey-access`, `session`, `internal-actor-administration`, and `actor-legal-name`. They preserve the useful donor separation between health, consumer credentials, managed login/recovery, operator passkeys, session lifecycle, actor/role administration and verified legal names. Every file contains only `paths: {}` and none is referenced by the root entrypoint. Names do not approve old development-session or privileged-access endpoints. See [the pinned donor inventory](../../../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md).

A future **approved** implementation slice must first reconcile Product meaning, consumers and owner permissions, then introduce real Path Items, validation and refs without a second contract truth. At that point replace the exact scaffold-only gate with a standard strict OpenAPI/YAML parser, full local ref resolution, duplicate path/operationId tests, security/error/schema tests and generated client parity. The existing source-only guard enforces only the exact **zero-operation scaffold**, not arbitrary OpenAPI validity.

No historical donor endpoints, localhost servers, authentication schemes, schemas, SQL, mocks or generated clients are transferred by this change. Actual APIs, runtime, database and independent critical-risk review remain NOT_RUN.
