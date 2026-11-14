# Identity OpenAPI — Progressive Session Verification

STATUS: CONTRACT_IN_PROGRESS
EXECUTION: IN_PROGRESS
SEMANTIC_OWNER: Identity
PRODUCTION_ACTIVATION: BLOCKED

The canonical Identity entrypoint is `identity.openapi.yaml` (OpenAPI 3.1.0). Version 0.1.0 now declares **only** the development-scoped `GET /v1/sessions/current` operation and its mandatory HTTP bearer security scheme. There is **no server declaration**, no live token issuer, no Operator Passkey authentication, no onboarding role mutation, and no authorized production session integration.

The previous zero-operation scaffold was described by the phrase `no server, no security scheme`; that historical statement is **no longer the current Identity contract**. The current contract explicitly has a bearer security scheme but deliberately no `servers` root. Reserved seven `paths/*.yaml` groups remain empty and unreferenced. No generated client or real credential integration is implied.

The stage-aware structural guard provides operation-ID/security/error boundary checks, **not arbitrary OpenAPI validity**, full YAML parsing, generated-client parity, real security or a protected Identity runtime attestation. Real SQL readback and adversarial session tests are the admission proof for this limited owner slice, distinct from HTTP 200 and documentation.

Canonical authorization and actor/role decision owner: [Identity governance](../../../../governance/identity.md). Single writer: Identity. Production release, protected accounts, passkey factor enrollment, recovery and WLT/DSH cross-owner authorization are not admitted by this development contract.
