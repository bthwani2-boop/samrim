# Development Guide Router

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE_INDEX
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

This directory contains **human procedures only**. Durable meaning belongs to `governance/**`; current implementation truth belongs to executable source/runtime; execution and closure belong to the Orchestrator.

Load one focused guide:

- `workflow/developer-workflow.md` — repository orientation, setup, first-change workflow, evidence discipline, authorized-slice delivery and optional LeanCTX use.
- `backend/service-development.md` — service boundaries, contracts/generation, database/migrations and cross-service effects.
- `frontend/frontend-and-routing.md` — app-host composition, frontend state/wiring, Control Panel actions, routing/search/notifications placement.
- `frontend/design-system.md` — reusable design tokens/primitives, accessibility/RTL and just-in-time extraction.
- `mobile/mobile-and-eas.md` — mobile runtime/device workflow, Expo/EAS identity, preflight/build and provider/signing isolation.
- `runtime/runtime-and-configuration.md` — runtime profiles, configuration/secrets, development providers/sandboxes and local/integration infrastructure.
- `observability/observability-and-sentry.md` — logs/metrics/traces, debugging, privacy/redaction and Sentry activation.
- `quality/quality-and-verification.md` — CI, testing, evidence classes, knowledge/docs verification and negative-space assurance.
- `release/release-and-store-submission.md` — release attribution, compatibility choreography, store submission, rollout and launch observation.

Do not add another development file when one of these owners can represent the procedure coherently. If a guide becomes multi-responsibility, split by real workflow ownership rather than by arbitrary line count.
