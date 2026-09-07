# Notifications Communications

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/communications/notifications-communications.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: NOTIFICATIONS_COMMUNICATIONS

## Scope

This file is the **sole editable durable semantic owner** of `NOTIFICATIONS_COMMUNICATIONS`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### NOTIFICATIONS_COMMUNICATIONS

**Problem.** Domain events, inbox state, delivery preferences and provider attempts can diverge or duplicate communication.

**Required outcome.** Source domains retain business-event truth while a governed notification capability owns inbox/preference/delivery semantics and app hosts own native route translation.

**Primary actors.** customer, partner, captain, field, operator, source-domain system, notification-delivery system.

**Canonical ownership.**
- source business event/eligibility — originating domain;
- notification inbox/preferences/topic configuration/delivery-attempt record — DSH Notifications capability;
- vendor channel execution — replaceable adapter;
- native/deep-link route mapping — app host.

**Durable semantics.**
- notification item has actor identity/type, topic, localized content/action target, read/unread state and creation/read timestamps;
- preferences are actor/topic scoped, enabled/disabled, channel-set, quiet-hours, locale/timezone aware;
- platform topic config is versioned and can mark a notification mandatory where Product explicitly requires it;
- delivery retries/deduplication never repeat the source business mutation.

**Forbidden/negative invariants.**
- no provider success/failure rewrites source-domain truth;
- no channel bypasses consent/preference except an explicitly mandatory governed topic;
- no app route string becomes durable domain meaning;
- no duplicate provider attempts create duplicate user/business effects;
- no secrets/unnecessary PII in notification/audit payloads.

**Failure/recovery.** invalid destination/channel, provider unavailable/timeout, duplicate attempt, delayed delivery, app route unavailable, preference conflict; preserve inbox/business truth and reconcile delivery separately.

**Acceptance expectations.** actor can list/read owned inbox and update allowed preferences; delivery has correlation/dedupe/audit; required native routing and degraded states are truthful.

**Material deployable surfaces.** all applicable actor apps when inbox/preferences/native navigation are exposed, plus control-panel for authorized topic/configuration/diagnostics.

**Target state.** DSH Notifications owns actor inbox, preferences/topic configuration and delivery-attempt lifecycle while source domains own business-event meaning, adapters own channel execution and app hosts own native route translation.
**Primary success measure.** eligible notification intents producing at-most-once governed inbox/delivery effects with correct preference and canonical readback.
**Guardrail measures.** source mutation repeated by delivery retry; consent bypass; duplicate inbox/delivery effect; cross-actor inbox access; provider result treated as source-domain truth.
**Business invariants**
- originating domain event remains canonical business meaning;
- DSH Notifications is the concrete owner/writer for inbox/preferences/topic/delivery records;
- channel adapters are replaceable and never business owners;
- app route strings are host translation, not durable domain meaning.
**Actor responsibility envelope**
- `recipient actor` — reads own inbox and changes allowed preferences; forbidden: access another actor or disable mandatory governed topics.
- `source domain` — emits canonical semantic intent/event; forbidden: depend on provider result as business mutation truth unless explicitly governed.
- `DSH Notifications` — owns inbox/preferences/delivery correlation/dedupe/readback.
- `channel adapter/app host` — executes transport/native routing only.
**Surface semantics**
- all applicable actor apps — required when they expose inbox/preferences/native navigation.
- `control-panel` — conditional topic/config/diagnostics within permission.
- `backend` and `database` — required DSH notification owner persistence/dedupe/preferences.
- technical presentation binding — implementation evidence only.
