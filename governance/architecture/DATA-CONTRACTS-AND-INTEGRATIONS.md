# Data, Contracts and Integration Boundaries

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md
EXECUTION_AUTHORITY: NONE

## Data authority

Every material persisted fact has one canonical domain owner and writer. Persistence technology does not define domain ownership.

Derived, cached or materialized copies must be explicit, one-way where possible and rebuildable where practical.

## Contract sovereignty

Each service owns the executable contract for its public semantics. Cross-service contracts/events have deterministic provenance and generation.

One semantic source leads to one executable contract, deterministic generation and required consumers.

Hand-maintained DTO/enum/status/action/operation mirrors are forbidden when they compete with executable owner sources.

## Root protocol/catalog boundary and generation lineage

Service business operations remain under the owning service contract source. A root `contracts/` area, when present, is limited to genuinely cross-service protocol primitives and derived discovery/catalog outputs.

~~~text
SERVICE BUSINESS CONTRACT → service owner
GENUINELY CROSS-SERVICE WIRE PRIMITIVE → root protocol owner when proven
REPOSITORY-WIDE API DISCOVERY INDEX → generated/derived or absent
~~~

A repository-wide API/OpenAPI catalog must not be a manually synchronized business authority. When consumers need one:

~~~text
CANONICAL SERVICE CONTRACTS
→ DETERMINISTIC DISCOVERY
→ GENERATED NON-AUTHORITATIVE CATALOG
~~~

Each service exposes one canonical composition/validation source for its public contract. Physical schema files may be split for cohesion, but one semantic operation/status/action cannot acquire parallel sources.

Generated clients/bindings follow:

~~~text
CANONICAL EXECUTABLE CONTRACT
→ VALIDATE/COMPOSE
→ DETERMINISTIC GENERATION
→ REPRODUCIBLE OUTPUT
→ CONSUMERS
→ DRIFT CHECK
~~~

A private hand-written parser/generator is not preferred when mature canonical tooling supports the required contract faithfully; exact tool selection is implementation/Docs truth and must pass current dependency/adoption policy.

## Version compatibility

Compatibility exists only for deployment combinations that can occur in reality.

- `TEST_ONLY_VERSION_COMBINATIONS_THAT_CAN_EXIST_IN_REAL_DEPLOYMENT`
- `INDEFINITE_DUAL_SEMANTICS = FORBIDDEN`
- `COMPATIBILITY_JUST_IN_CASE = FORBIDDEN`

A bounded compatibility window requires owner, scope, cutover condition, telemetry/migration evidence where applicable and a deletion trigger.

## External integration model

A domain expresses the semantic capability it requires. External adapters implement it.

Durable separations include:

- Geo/Maps capability → map/geocoding/routing adapter.
- Push Delivery → push provider adapter.
- Email Delivery → email provider adapter.
- OTP Delivery → channel adapter; Identity owns the challenge.
- FinancialRail → moves/authorizes external money.
- BillerGateway → fulfills recharge/bill service.
- ObjectStoragePort → stores binary/object content.

FinancialRail and BillerGateway are distinct because moving money and fulfilling a bill/recharge are different semantic responsibilities.

## Unknown outcomes

For external mutations:

- `TIMEOUT != FAILURE`
- `MISSING_CONFIRMATION != SUCCESS`
- `UNKNOWN MUST REMAIN UNKNOWN UNTIL RECONCILED`

Do not blindly retry an ambiguous mutation through another provider until duplicate external effect is proven impossible.

## Secrets

Provider credentials, signing keys and tokens are secret-store/runtime-binding concerns. They are not ordinary business rows, client configuration or audit payload.
