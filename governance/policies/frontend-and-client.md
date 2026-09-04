# Frontend, Mobile, and Client Engineering Policy

ARTIFACT_CLASS: DURABLE_FRONTEND_POLICY
SEMANTIC_OWNER: governance/policies/frontend-and-client.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Core rule

A client surface presents and coordinates canonical Product/System truth; it does not become an alternate business, authorization, financial or persisted-state owner for convenience.

## Responsibility by client layer

### Screen / TSX / view

Allowed: composition, rendering, ephemeral interaction state, accessibility semantics, formatting, navigation wiring, local visual state and delegation to owned controllers/components.

Forbidden final authority: durable business decisions, authorization policy, financial calculations, copied server state machines, direct database/provider access, authoritative persisted success, hidden mock/fallback business data.

### Controller / hook / view-model

Owns request lifecycle, cancellation, retry coordination, canonical readback, presentation derivation, form/draft orchestration, cache invalidation and surface-level recovery. It may derive display state but may not redefine domain invariants or trusted permission context.

### API/contract adapter

Owns transport/protocol mapping, generated client consumption, error/shape normalization and bounded platform adaptation. It must not become a second contract/business owner.

### Shared UI

Owns reusable presentation primitives/patterns and semantic interaction behavior. Cross-surface reuse cannot move domain authority into the UI kit.

## Canonical readback and mutation truth

When persisted/server truth matters, visible success follows committed canonical readback or an explicitly governed equivalent. Toasts, local state or optimistic rendering cannot establish persisted truth.

Optimistic mutation is allowed only when the Product/contract semantics make rollback/conflict behavior safe and explicit. Unknown provider/financial results remain unknown/reconcilable rather than fabricated as success.

## Local state, cache, persistence, and offline

Local state is subordinate to canonical authority. Persisted local cache/offline queues must define ownership, freshness, synchronization, conflict/replay semantics, corruption recovery and sensitive-data handling. Offline support must not introduce a second business state machine or authorize an action that current server truth forbids.

## Mobile/client lifecycle

When material, handle secure storage, bootstrap/session restore, process death, background/resume, app-state transitions, deep links/intents, push handling, platform permissions, local persistence, network changes, cancellation and re-authentication consistently with canonical Product/Security truth.

New-device/session behavior is an Identity/security concern; client storage cannot silently extend revoked or unauthorized trust.

## Resource correctness

Subscriptions, listeners, timers, async work, fetches, caches and retained state must be bounded and cleaned up across re-render, navigation, background/resume and unmount. Unbounded retry/render/fetch loops and stale subscriptions are correctness/reliability defects, not mere polish.

## Forms and validation

Client validation improves usability; server/domain validation remains authoritative. Preserve input safely on recoverable failure, prevent unsafe duplicate submission, focus/actionably expose errors and never echo secrets/sensitive values unnecessarily.

## Authorization and object scope

UI visibility is not authorization. Hide or disable actions for usability as appropriate, but every protected read/write is server-authorized against trusted context and object/business scope. A client-controlled header/query/body/local selection may express intent but cannot grant trusted scope.

## Accessibility, localization, and RTL

Accessibility, Arabic/RTL/localization, readable states, keyboard/focus semantics on web, touch/target/text-scaling behavior on mobile and reduced-motion support are correctness dimensions when materially applicable. Platform adaptation may change layout/interaction details but not Product meaning.

## Human-visible state

Required applicable states include truthful loading, empty/no-results, forbidden, conflict, offline/weak-network, partial/stale, error, retry/recovery and terminal readback. Do not render fake metrics, health, balances, catalog/order/store state or badges merely to avoid an empty/error experience.

## Design-system binding

Durable Product/experience meaning comes from `../product/EXPERIENCE-AND-DESIGN.md` and capability governance. Shared runtime design tokens/components implement those decisions. Surface-local reusable foundations are defects when they independently encode the same material cross-surface decision without a proven platform/task reason.

## Performance and perceived performance

For material journeys consider payload size, pagination, repeated fetch/render work, image/media lifecycle, startup/bootstrap cost, interaction responsiveness and weak-device/network behavior. Do not invent arbitrary performance numbers; use authorized requirements or measured evidence.

## Closure

Client closure requires correct ownership, canonical contract binding/readback, complete applicable states, lifecycle/resource cleanup, security/privacy handling, accessibility/RTL/localization where material, migrated consumers and no local mock/fallback/duplicate state authority tied to the root.
