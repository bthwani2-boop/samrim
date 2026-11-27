# Plan — Identity verified sessions, role admission and Operator access

ARTIFACT_CLASS: DERIVED_SPEC_KIT_PLAN
CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS

Use [spec.md](spec.md) for the feature criteria and [AGENTS.md](../../AGENTS.md), [Identity governance](../../governance/identity.md), [engineering law](../../governance/engineering.md), [safety](../../governance/safety.md), and [repository structure](../../REPOSITORY-STRUCTURE.md) for owner and execution decisions. These documents confer no additional permission. Apply the native Spec Kit phases that fit the affected scope; do not create a new branch or work source.

## Canonical implementation boundaries

| Responsibility | Existing owner source and consumers |
| --- | --- |
| Session read/logout and permission read | [Identity session domain](../../services/identity/backend/internal/session/), current-session and internal-administration OpenAPI paths; [public Identity client](../../services/identity/clients/); DSH verified session and explicit scope consumers. |
| Phone and eligible role admission/re-entry | Identity phone, Merchant and Captain owner files in the session domain, owner contract/client; DSH standing and Store grants remain independent. |
| Persistent families | Identity persistent session owner, session OpenAPI and client; app-specific Web cookie and Android session/persistence consumers. |
| Operator credentials and grants | Identity bootstrap, authentication, recovery and permission-management owners; Control Panel presentation/BFF. Separate owner permission checks at every DSH/WLT effect. |
| Data | [Identity ordered fresh baseline](../../services/identity/database/schema/): 00_identity.sql, 10_verification.sql, 20_sessions.sql, 30_operator_permissions.sql, 40_operator_passkeys.sql. No separate migration history for experimental fresh installs. |

The [Identity owner guide](../../services/identity/README.md) routes the actual isolated runtime configuration, capabilities and contract. The [OpenAPI entrypoint](../../services/identity/contracts/openapi/identity.openapi.yaml) references its canonical paths and generated clients. Do not duplicate this inventory in another executable contract. Retired experimental SQL remains historical Git evidence only; preserve actual applied history and use the separately authorized retained-data epoch rather than replaying the fresh baseline. [Infrastructure](../../infra/README.md) owns the Compose/runtime lifecycle and isolated trust material.

## Implementation and evidence route

1. Establish live authority, exact repository/source and actual affected writer/consumers, applicable versioned engineering references, owner contract, schema, data and runtime. Use native Specify; determine local Graphify applicability under AGENTS.md and verify exact freshness and supported membership when applicable. Inspect actual source and unsupported formats directly. Evaluate all affected files/units under DELETE / REFOUND / KEEP before any remediation.
2. Prove the relevant trigger at the actual owner, retain positive rights/behavior and rejection, and use the canonical Go/SQL/HTTP transaction boundary; never introduce another Identity engine, new actor identity or client-driven grant. Use current owner API/SDK operations and existing consumers, including late response and cross-account/Store isolation. Separate command outcomes from display state.
3. Verify owner tests (positive, malformed, negative, replay, races, denial and durable readback); use pinned Go, native contract/client checks and isolated PostgreSQL. For changes in protected factors, sessions, grants, recovery or schema, document the executor adversarial security assessment and test actual authorization and recovery; do not substitute optional reviewer staffing for mandatory evidence.
4. Verify actual scoped Web/Android behavior, current admitted synthetic runtime identity and separate owner SQL readback where affected. Neither synthetic OTP nor cryptographic fixtures establish production or protected real identity. Protected Root enrollment, retained-data upgrade, permission/credential changes and service activation keep their specific authorization.
5. Deliver each complete tested owned foundation immediately under AGENTS.md. Verify exact published source and applicable CI. Reconcile evidence at the existing authorized issue and owner, with remaining criteria open. No duplicate progress register, peer delivery reservation or global prerequisite for independent safe work.

## Proof sources (select affected cases)

- Native Go unit/negative checks and existing real PostgreSQL/HTTP tests in the [session domain](../../services/identity/backend/internal/session/): current session readback, scoped logout/race, role admission and expiry, persistent families, phone TLS/verification, Captain standing, Operator bootstrap and signed WebAuthn, permission management, recovery refusal and credential bounds. A named test file is not a claim that every criterion already ran or passed.
- [Isolated owner integration](../../tests/infra/verify-owner-postgres-ci.sh) and [fresh baseline/restore proof](../../tests/infra/verify-isolated-postgres.ps1) provide distinct owner database evidence. Do not point fixtures at retained data or manufacture a successful result through manual SQL.
- Native OpenAPI/SDK parity, affected source and regression checks, exact candidate CI/security results, owner-backed integration, browser and actual device checks. Use [tasks.md](tasks.md) to select verification scope. Read actual test and runtime evidence, not a historical SHA or a healthy container.

Historical phase plans, migrations and delivery records are preserved at the [prior immutable feature tree](https://github.com/bthwani2-boop/samrim/tree/e7c7513c385650e79adaecbb486090902620c5ed/specs/004-identity-session-verification). Use them for provenance and unresolved obligations, not present commands, gates or acceptance. This derived plan does not certify a completed implementation, operational transition, original-Owner continuity, full journey or production.
