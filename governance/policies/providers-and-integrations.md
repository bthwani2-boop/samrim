# Providers and External Integration Policy

ARTIFACT_CLASS: DURABLE_INTEGRATION_POLICY
SEMANTIC_OWNER: governance/policies/providers-and-integrations.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Scope and owner boundary

This policy owns durable provider/integration operating rules that specialize the architectural port model in `../architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md`, the secret/trust requirements in `security.md`, and runtime/configuration classes in `../architecture/RUNTIME-AND-CONFIGURATION.md`.

It does not create Product capabilities from vendor names and does not make Platform Control, Infra or a generic provider service the execution owner of domain effects.

~~~text
BUSINESS/PRODUCT EFFECT OWNER
→ SEMANTIC PORT
→ VENDOR ADAPTER

VENDOR != DOMAIN
PROVIDER CATALOG != BUSINESS OWNER
CONTROL PLANE != DATA PLANE
~~~

## Semantic port design

Ports are named after the capability the owning domain needs, not a generic execute operation.

Examples of admissible semantic responsibilities include:

~~~text
GeocodeProvider
RouteProvider
PushDeliveryProvider
EmailDeliveryProvider
OtpDeliveryProvider
FinancialRail
BillerGateway
ObjectStoragePort
FraudSignalProvider
~~~

A generic `Provider.execute(request)`, global `ProviderManager` or vendor-switching god service is forbidden when it obscures domain semantics, authorization, idempotency, failure handling or money-movement meaning.

Vendor-specific details terminate inside the adapter and are translated into canonical domain/provider result classes before crossing the owner boundary.

## Control-plane versus data-plane separation

Cross-service provider configuration may have a governed control-plane owner when an independent lifecycle is proven. Actual provider invocation remains with the domain/integration owner whose operation creates or consumes the effect.

Control-plane metadata may include materially applicable:

- provider code/type;
- enabled/disabled state;
- non-secret routing/selection metadata;
- rollout/version metadata;
- secret reference identifier;
- health/readiness metadata that does not redefine domain truth.

The control plane must not become the runtime executor of unrelated DSH/WLT/Identity operations.

## Secret architecture

Provider credentials are secret-store/runtime-binding material. General application/business rows may hold only the minimum non-secret reference/metadata required to resolve the secret.

~~~text
BUSINESS/CONFIG ROW → secret_ref + non-secret metadata
RUNTIME SECRET STORE → actual secret value
~~~

Secrets must not be:
- returned through ordinary API/frontend responses;
- embedded in audit snapshots;
- logged/traced;
- committed to Git;
- stored as plaintext/general JSON credential blobs in ordinary business tables;
- placed as real values in example environment files.

Rotation must be possible without rewriting business history or changing domain semantics.

## Provider execution provenance

Every externally material operation records enough non-secret provenance to distinguish what was attempted and what result is known.

As applicable record:

- provider/config identity and version;
- correlation/idempotency identity;
- provider request/reference identity;
- attempt timestamp/sequence;
- normalized result class;
- authoritative external reference when returned;
- unknown/ambiguous outcome marker;
- reconciliation linkage;
- originating business operation identity.

Provider provenance is evidence for the domain effect; it is not a second ledger/order/payment source of truth.

## Retry and fallback classes

Retry behavior is operation-class specific.

### Read/lookup operations

For replaceable reads such as geocoding/routing/search, bounded retry/fallback may be allowed when it cannot create duplicate external state and semantics remain equivalent.

### Messaging delivery

Messaging channels may retry according to channel/provider behavior when duplicate delivery risk, message identity and user impact are controlled. Source business-event meaning remains with the source domain.

### Financial or otherwise externally mutating operations

Ambiguous mutation outcomes remain unresolved until the original provider result is established or reconciled.

~~~text
SEND_MUTATING_COMMAND
→ CONFIRMED ? APPLY_CANONICAL_RESULT
→ DEFINITIVE_FAILURE ? GOVERNED_RETRY_OR_ALTERNATIVE_IF_ALLOWED
→ UNKNOWN ? PERSIST_UNKNOWN
           → QUERY/RECONCILE_ORIGINAL_PROVIDER
           → PROVE_ABSENT/FAILED
           → ONLY_THEN_CONSIDER_RETRY/ALTERNATE_RAIL
~~~

Blind failover of an unknown financial mutation to another provider/rail is forbidden.

## Webhooks and callbacks

Where providers deliver callbacks/webhooks:

1. authenticate/verify the provider callback using the provider-supported trust mechanism;
2. enforce replay/timestamp/body/schema limits as applicable;
3. bind the event to provider/config/version and stable provider event identity;
4. process idempotently;
5. translate provider payload into canonical domain state/event semantics;
6. preserve attributable provenance;
7. never trust client-supplied provider success as provider evidence.

Duplicate/out-of-order provider events must not create duplicate or illegal domain effects.

## Development, sandbox and simulator policy

Use real provider sandboxes/free development environments where practical for contract/integration fidelity. Pricing/trial availability is mutable external information and is revalidated at adoption/use time.

Deterministic simulators are valid for failure-path testing but their behavior belongs with the service/integration testing owner, not generic Infra.

~~~text
SERVICE-SPECIFIC PROVIDER SIMULATOR
→ owning service testing/integration area

ENVIRONMENT COMPOSITION
→ infra

SIMULATOR RESULT
!= PRODUCTION PROVIDER TRUTH
~~~

A simulator must cover materially required timeout, duplicate, malformed, unavailable, partial and unknown-outcome classes without changing canonical business rules.

## Provider adoption and replacement

Provider selection follows `standards-and-quality.md` dependency/adoption law. Vendor replacement must preserve the semantic port and canonical domain behavior unless a deliberate Product/System change is separately governed.

Do not introduce multiple providers merely for architectural flexibility. Multi-provider routing/fallback requires a proven requirement, explicit selection semantics, result provenance, operational ownership and safe unknown-outcome behavior.

## Required conformance properties

For any materially affected provider/integration responsibility, the implementation must conform to the applicable properties below. Concrete candidate evidence and closure remain Orchestrator authority:

~~~text
GENERIC_PROVIDER_GOD_SERVICE=0
GENERIC_EXECUTE_INTERFACE=0
DOMAIN_SPECIFIC_SEMANTIC_PORTS=PASS
CONTROL_PLANE/DATA_PLANE_SPLIT=PASS
RAW_PROVIDER_SECRETS_IN_GENERAL_DB=0
SECRET_VALUES_IN_GIT/CLIENT/API/AUDIT=0
PROVIDER_RESULT_PROVENANCE=PASS
UNVERSIONED_PROVIDER_CONFIG_FOR_MATERIAL_MUTATION=0
BLIND_FALLBACK_ON_UNKNOWN_MUTATION=0
UNRECONCILED_UNKNOWN_FINANCIAL_OUTCOME=0
WEBHOOK_TRUST/REPLAY/IDEMPOTENCY=PASS_WHEN_APPLICABLE
SERVICE_SPECIFIC_SIMULATOR_MISOWNED_BY_INFRA=0
~~~

Exact implementation state and provider health are runtime/source evidence, not durable Governance.
