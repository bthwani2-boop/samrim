# Target — External Providers and Integrations

## 1. No generic Providers god service

`core/providers` must not be moved wholesale to `services/providers` merely because it currently exists.

The word `provider` spans unrelated domains: maps, payments, SMS, email, push, storage, search, fraud, and future integrations. A single execution service for all of them would centralize unrelated semantics and become a coupling bottleneck.

Refound the current subtree by responsibility.

## 2. Control plane versus data plane

### Integration control plane

Platform-wide configuration governance belongs with Platform Control when the current responsibility truly is cross-service control-plane behavior:

```text
provider/integration registration
capability binding
activate/deactivate
non-secret parameters
secret reference
configuration version
rollout/change workflow
audit
aggregated health/posture view
```

Canonical candidate:

```text
services/platform-control/backend/internal/external-integrations/
```

Choose a more precise name if census proves a narrower responsibility.

### Data plane

Actual external request execution belongs with the service that understands the operation.

Examples:

```text
DSH/integrations/maps/
  Geocoder
  RoutePlanner
  google adapter
  mapbox adapter

WLT/integrations/payment-rails/
  PaymentGateway
  PayoutRail
  stripe adapter
  paypal adapter

Identity/integrations/messaging/
  SmsSender
  EmailSender
  twilio adapter
  resend adapter
```

Vendor examples are illustrative adapters, not mandated production choices.

## 3. Port design

Business/domain code depends on semantic ports, not generic vendor interfaces.

Preferred style:

```text
Geocoder
RoutePlanner
PaymentGateway
PayoutRail
SmsSender
EmailSender
PushSender
ObjectStorage
FraudSignalProvider
```

Forbidden default:

```text
Provider.execute(request)
GenericProviderClient
ProviderManager that routes all business integrations
```

A vendor adapter may expose vendor-specific details internally but must translate to the semantic port at the owning boundary.

## 4. Secret architecture

Current storage of provider secret material as `credentials jsonb` in a general PostgreSQL table is a losing authority.

Target:

```text
provider/integration configuration store:
  code
  capability
  environment
  active state
  non-secret parameters
  secret_ref
  config version
  audit metadata

protected secret store/deployment binding:
  API keys
  client secrets
  private keys
  webhook signing secrets
  access tokens
```

Secrets must not be returned through API/frontend, logged, embedded in audit snapshots, committed to Git, or placed as values in `.env.example`.

Prefer runtime secret managers/vaults in deployed environments. Local development may bind secrets from protected local environment mechanisms, never from tracked values.

Rotation must be possible without changing business records or code.

## 5. Provider result provenance

Every externally material mutation must record enough non-secret provenance to prove what happened, as applicable:

```text
provider code/config version
provider request/idempotency identity
remote transaction/reference ID
attempt identity
request correlation ID
provider outcome class
occurred/observed timestamps
reconciliation state
```

Do not log secret payloads or sensitive unnecessary data.

## 6. Retry/fallback classes

### Read/lookup operations

Examples: geocoding, routing, non-financial search.

Bounded retry/fallback may be allowed when semantic equivalence and result-quality differences are understood.

### Messaging

SMS/email/push fallback requires dedupe/idempotency and explicit delivery-attempt lifecycle to avoid duplicate user communication.

### Financial mutation

Never blind-fallback on timeout or unknown result.

```text
SEND_FINANCIAL_COMMAND
→ OUTCOME_CONFIRMED ? finish
→ OUTCOME_UNKNOWN ? persist UNKNOWN
→ QUERY/RECONCILE ORIGINAL PROVIDER
→ PROVE ABSENT/FAILED
→ ONLY THEN decide safe retry/alternate rail
```

Provider provenance and reconciliation are mandatory for payment/payout/refund/financial commands where external execution is material.

## 7. Webhooks/callbacks

Where providers use callbacks/webhooks:

```text
verify signature/authenticity
bind event to provider/config/version
idempotently ingest
persist receipt/provenance when material
handle replay/out-of-order events
translate to canonical domain event/state
never trust client-supplied provider result
```

## 8. Development strategy

For each critical integration prefer both:

```text
DETERMINISTIC_LOCAL_SIMULATOR
+
AT_LEAST_ONE_REAL_SANDBOX/FREE-DEVELOPMENT PROVIDER WHERE PRACTICAL
```

Local simulators prove exact failure/timeout/duplicate/unknown scenarios and run deterministically in CI. Real sandboxes prove adapter compatibility with external APIs.

Examples that may be evaluated at execution time from current official docs include Stripe/PayPal sandboxes, Mapbox/Google Maps development quotas, Firebase Cloud Messaging, Resend, Twilio trial, and MinIO for S3-compatible local object storage. Current pricing/trial terms are not architectural truth and must be freshly verified before adoption.

## 9. Simulator ownership

Behavioral fixtures/mappings belong with the service integration they simulate:

```text
services/wlt/testing/provider-simulators/...
services/dsh/testing/provider-simulators/...
```

Environment orchestration that starts those simulators belongs in `infra/local/compose`.

```text
TEST_BEHAVIOR → SERVICE TESTING OWNER
ENVIRONMENT_COMPOSITION → INFRA
```

## 10. Migration from `core/providers`

```text
CENSUS_CONFIG/HEALTH/CREDENTIAL/INVOCATION RESPONSIBILITIES
→ CLASSIFY CONTROL-PLANE VS DOMAIN DATA-PLANE
→ MOVE CONTROL-PLANE TRUTH TO PLATFORM-CONTROL IF PROVEN
→ CREATE DOMAIN-SPECIFIC PORTS
→ MOVE/REBUILD VENDOR ADAPTERS UNDER OWNING SERVICES
→ MIGRATE SECRET VALUES OUT OF GENERAL DB TO SECRET STORE/BINDING
→ REPLACE credentials WITH secret_ref/metadata
→ CUT OVER READERS/WRITERS
→ DELETE GENERIC INVOCATION AUTHORITY
→ DELETE core/providers
→ PROVE OLD PATH/PACKAGE/API=0
```

Do not preserve a compatibility Providers service internally.

## 11. Exit gate

```text
core/providers=ABSENT
GENERIC_PROVIDER_GOD_SERVICE=0
GENERIC_EXECUTE_INTERFACE=0
PLAIN_PROVIDER_SECRETS_IN_POSTGRES=0
SECRET_VALUES_IN_GIT/CLIENT/API/AUDIT=0
DOMAIN_ADAPTERS_OWNED_BY_PLATFORM_CONTROL=0
UNVERSIONED_PROVIDER_CONFIG_USED_FOR_MATERIAL_MUTATIONS=0
BLIND_FINANCIAL_FALLBACK=0
UNRECONCILED_UNKNOWN_FINANCIAL_OUTCOME=0
SIMULATOR_BUSINESS_FIXTURES_MISOWNED_BY_INFRA=0
```
