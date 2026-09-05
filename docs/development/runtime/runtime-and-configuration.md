# Runtime, Configuration and Development Providers

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_RUNTIME_TRUTH_SOURCE: live repository scripts/configuration
CURRENT_VALUE_TRUTH_SOURCE: EXECUTABLE_CONFIG
CURRENT_PROVIDER_CONFIG_TRUTH_SOURCE: live repository configuration

## Runtime profiles

Use the smallest runtime able to prove the current claim:

- **DAILY_DEV** — active app/service plus minimum dependencies.
- **FOCUSED_INTEGRATION** — exact cross-service/provider/database dependencies required by the capability.
- **FULL_INTEGRATION** — repository-owned orchestration for migrations/readiness/contracts/runtime/journey/failure proof.

Current integration-runtime commands are derived from `package.json`; canonical full proof is `pnpm runtime:integration:close`. Do not turn this guide into a second command/port registry.

## Stateful dependencies

PostgreSQL/PostGIS provides relational durable development state according to service boundaries. Object storage remains an adapter behind owner-domain semantics. Redis/Valkey is optional cache/coordination infrastructure and must never become Product truth. Docker is a reproducible integration path, not mandatory daily runtime.

Development external services receive synthetic/test data only.

## Configuration classes

Keep separate:

- build/deployable configuration;
- runtime environment configuration;
- platform-governed variables/flags;
- secret references/values;
- user/business state.

Secret values do not belong in Git, client bundles, generic database rows, ordinary logs/traces or public configuration. Public mobile/web environment variables contain only public-client-safe values.

Platform-governed variables require server-side schema/type validation, version/audit/reason/rollout/readback and cannot bypass domain authorization/invariants.

Missing security-, finance- or correctness-critical configuration fails safely instead of silently selecting insecure fallbacks.

## Identity runtime credentials

Identity internal service identity is derived server-side from configured bearer credentials such as DSH and Platform Control service tokens. These tokens are distinct and validated; callers do not provide trust headers to compensate for missing business authorization modeling.

Challenge HMAC/delivery configuration remains server/runtime state, never a client authority. Development examples are placeholders, not production secrets.

## Development providers and simulators

Provider names do not define domains. Daily development should prefer deterministic low-cost sinks/simulators unless the real external channel is the test objective.

Identity owns challenge lifecycle; SMS/email/push are transport channels. Local sinks must still preserve challenge lifecycle, attempt limits and supersession semantics.

Financial/biller simulators should cover success, rejection, pending, timeout, delayed/unknown result, duplicate reference/callback, invalid signature, reversal and reconciliation mismatch as applicable. WLT authorization/accounting/idempotency/reconciliation/readback remain real.

Maps/media/storage providers remain replaceable adapters.

```text
DEVELOPMENT_PROVIDER != DOMAIN_AUTHORITY
DEVELOPMENT_PROVIDER != REQUIRED_PRODUCTION_PROVIDER
PROVIDER_NAME != BUSINESS_DOMAIN
FAKE_SUCCESS_BYPASSING_OWNER_STATE_MACHINE = FORBIDDEN
PRODUCTION_DATA_IN_GENERAL_DEV = FORBIDDEN
```

## OTP/SMS abuse boundary

Public challenge flows preserve production-grade abuse boundaries even when local delivery is cheap: per-phone/IP/device velocity where applicable, resend cooldown, attempt caps, country/number policy, spend limits when real paid delivery is enabled, challenge supersession policy and no raw OTP persistence/logging.

Exact thresholds are runtime/policy configuration, not documentation constants.
