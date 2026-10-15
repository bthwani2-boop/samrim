# BThwani — Tawseel One cross-surface parity and superiority closure plan

DOCUMENT_CLASS: NONAUTHORITATIVE_EXECUTION_PLAN
PLAN_OWNER: docs/tawseel-one-cross-surface-closure-plan.md
DATE: 2026-10-15
LOCAL_TARGET: D:\\samrim (branch/HEAD must be read at each material write)
REFERENCE_OWNER: docs/reference/competitors/tawseel-one.md
SOURCE_OF_TRUTH: approved docs/governance owners + current code/contracts/runtime
STATE: ACTIVE — evidence-based incremental closure, not a claim of 100% parity

## Mission and authority
Use Tawseel One as black-box reference for *observable functional and UX coverage*, not as executable authority. Reproduce the useful experience and comparable behavior with BThwani's own identity, design system, architecture, catalog, services, permitted assets and policies. Preserve BThwani capabilities which are superior or safer (multi-store checkout, fulfillment choices, identity scope, wallet ledger and idempotency). Where neither is adequate, choose the simplest complete BThwani solution. Never copy competitor branding/assets/source, decompile binaries, intercept private traffic or infer undocumented backend internals.

## Input and freshness boundary
- Cached observations: `docs/reference/competitors/tawseel-one.md` (partial Android black-box review, 2026-09-26/27).
- Ignored local-only screenshots: `docs/reference/competitors/local-photos/tawseel-one/`, including `tawseel-one-all-categories.png`, `tawseel-one-home-deep-followup-20260926.png` and 2026-10-15 follow-up.
- Device: authorized Samsung attached by USB; reference app package `com.smartapps.tawseel`; installed version readback must be rechecked. Observe through ordinary screen interaction/ADB only, without payment, order placement, data deletion, account changes or external messaging on competitor.
- Shared conversation context: https://chatgpt.com/share/6ad035fe-e6bc-83ed-ab24-9f6e675119b5 and https://chatgpt.com/share/6ad035a5-7440-83eb-9ff9-3fa8cb9e9fdb (links provided; contents not verified where inaccessible).
- Keep device captures local/ignored; avoid retaining private account/checkout content in commits or plan.

## Method — bounded discovery then working vertical slices
1. Inventory actual reference controls/states/routes, label `OBSERVED`, `INFERRED`, `NOT_TESTED_WITH_REASON`, or `STALE`. Refresh only missing or stale material evidence; do not re-audit everything repeatedly.
2. For each reference outcome, read corresponding current BThwani code, contracts, source-owned data, and governance. Mark `CLOSED_WITH_PROOF`, `PARTIAL`, `MISSING`, `DIFFERENT_BUT_BETTER`, or `NOT_ADOPTED_WITH_REASON`.
3. Prioritize a cross-surface functional slice by user harm, broken journey, reused platform root cause and implementation cone, not by screen count. Each slice includes relevant customer, partner, captain, field, control panel, DSH, Identity, WLT and catalog **only when affected**.
4. Implement coherent local batch directly in current owners: remove obsolete/duplicate paths, reuse existing API/state owners, preserve authorized roles/finance safety, no parallel shadow truth or speculative commercial feature.
5. Check smallest sufficient static tests and real Android/browser + backend canonical readback where material; prove failure/recovery and actor separation; do not claim cross-surface completion from TypeScript alone.
6. Confirm exact HEAD/dirty state, commit only task-owned files, push safely after proven batch; no merge/deploy/production/data resets without explicit authorization.

## User-facing coverage ledger (reference samples; NOT a list of missing code)
| Journey | BThwani outcomes to evaluate | Relevant owners |
| --- | --- | --- |
| Home / location / service city / navigation | state, addresses, availability, responsive RTL, banners, navigation | client, control, DSH |
| Categories / verticals / store discovery | all approved BThwani categories, taxonomy, published stores, distance, status, favorites, pagination | catalog, partner, client, DSH, control |
| Search / filters / offers | product/store modes, empty/retry, nearest/new/favorites, campaign publication, valid prices | client, partner, control, DSH, WLT if financed |
| Store menu / products | cover/logo, opening hours, fulfillment, catalog sections, variants, quantities, favorites | client, partner, catalog, DSH |
| Cart / checkout / payment | quote binding, fulfillment switching, addresses, modifiers, coupons, split wallet, order create, retry/idempotency | client, partner, DSH, WLT |
| Orders / execution / tracking | open carts, order status, repeat, cancel/adjust, notifications, partner dispatch, captain assignment, delivery proofs | all relevant actor apps, DSH, WLT |
| Profile / address / support | actor-bound edit/readback, city switching, help, external links, notifications | client, Identity, DSH, control as applicable |
| Pickup / custom-delivery / global shopping | distinguish admitted capabilities from competitor-only ideas; require approved scope before implementation | client, partner, captain, control, DSH |
| Loyalty / subscription / referral | product decision and sustainable entitlements before UI/API; do not silently add paid features | product governance, control, DSH, WLT |
| Failure / offline / accessibility / performance | timeouts, recoverability, RTL, labels, stale state, app relaunch, measured app behavior | all materially touched surfaces |

## Definition of complete for a slice
- Customer-visible task works through real API and canonical readback.
- Material partner/captain/field/operator handoffs work and are authorized where involved.
- Backend owns authoritative validation, idempotency, durable state and finance correctly.
- Loading, empty, validation, conflicts, retries, unavailable, RTL and state freshness are handled where applicable.
- Affected tests pass, representative on-device/web scenario is observed where needed, and evidence is current, proportionate and linked to exact commit.
- Unknown and blocked items stay openly `PARTIAL` or `NOT_TESTED_WITH_REASON` — never described as 100%.

## First execution priorities
- P0: preserve ongoing store-discovery work; inspect actual dirty files and avoid overlapping edits.
- P1: close demonstrable customer-critical usability and data-flow gaps in existing journeys with existing services (orders/open carts, account, catalog/discovery as safely owned).
- P2: execute real cross-surface checkout/order/handoff proof for existing fulfillment methods and money movement without disrupting durable data.
- P3: assess competitor-only capabilities (custom orders, global shopping, subscription) against current approved BThwani scope; adopt only deliberately, without mock APIs or unsupported claims.
- P4: full UI/state/performance/accessibility reconciliation and long-tail category/edge-case census after core slices.

## Execution record
- 2026-10-15 baseline: branch `19` HEAD `0086aa9b9f6126be42814307e73d0a1dd7f580eb`; existing uncommitted modifications in store-discovery and new store-directory-card belong to another in-progress task and must be preserved.
- Existing verified implementation: orders/open-carts and lifecycle filters added in commits `8d0658e4` and `0086aa9b`, passed TypeScript, Android interaction proof not yet established.
- This plan is an operating guide; update the record only for material checkpoints and outcomes, not after each tiny edit.
