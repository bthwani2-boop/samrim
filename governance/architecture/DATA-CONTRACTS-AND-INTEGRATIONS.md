# Data, Contracts and Integration Boundaries

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

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

## External-integration boundary

This architecture owner defines only the cross-boundary rule:

```text
DOMAIN-OWNED SEMANTIC NEED
→ EXPLICIT EXECUTABLE CONTRACT/PORT
→ REPLACEABLE EXTERNAL ADAPTER
```

It does **not** own provider selection, retry/fallback, callback trust, secret handling, simulator behavior or unknown-result operating policy. Those are owned by `../policies/providers-and-integrations.md` and `../policies/security.md` as applicable.

Provider/vendor names never become bounded-context or contract owners. External integration must preserve the owning domain's contract semantics and one canonical executable provenance.
