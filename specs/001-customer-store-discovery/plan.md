# Implementation Plan: Customer Store and Catalog Discovery

**Branch**: existing refoundation/clean-house-20261112; **Date**: 2026-11-14; **Spec**: spec.md
**Status**: IN_PROGRESS — DSH owner-backed PostgreSQL public discovery, Customer Web/Android smoke and scoped source tests are implemented and tested; Identity/Store-orderability/checkout, independent security acceptance and native iOS remain unproven.

## Summary

Deliver the smallest genuine Customer marketplace Store discovery backed by DSH-only public Store and Offer reads, with Arabic RTL Web/Android presentation. This was the original implementation plan; the DSH public Go service, OpenAPI root contract, typed client and Customer discovery screens have since been implemented in the current candidate. Later sections describing zero-operation scaffolds and absent runtime refer to the original starting state, not the current implementation. Store publication/discovery visibility is distinct from current Store opening, temporary pause and checkout orderability. Do not build checkout, money, an alternate catalog, mock readback or duplicate Store engine. Reconcile only relevant journey decisions as implementation proceeds; global governance cutover is not a prerequisite.

## Technical Context

- **Language/Version**: Existing source-pinned Go 1.27.3 (future DSH backend); installed TypeScript 7.0.2 and pinned Node 24.22.1/pnpm 12.15.0 in the current worktree.
- **Primary Dependencies**: Existing Expo Customer, Expo Router, Tamagui, @bthwani/tamagui-config and @bthwani/design-system. Do not upgrade or install new dependencies as a planning side effect.
- **Storage**: DSH-owned PostgreSQL target (exact physical isolation, schemas and upgrade plan require a separate reviewed decision); Customer may not persist canonical Store/Offer truth.
- **Contract**: existing services/dsh/contracts/openapi/dsh.openapi.yaml and reserved paths/customer-discovery.yaml, paths/stores.yaml, paths/catalog.yaml and paths/offers.yaml are zero-operation placeholders. Do not hand-invent paths, auth schemas, DTOs or prices.
- **Tests**: contract parser/ref validations once admitted, DSH Go owner tests, negative visibility/ACL and real query tests, cross-store isolation, genuine Customer Web/Android smoke; Postman read of old local-readiness collection is not a new service test.
- **Platform**: Customer Expo Web SSR and Android. Actual iOS acceptance remains unproven until tested.

## Constitution Check — initial pre-implementation snapshot (historical; see current evidence below)

| Gate | Current evidence | Decision |
| --- | --- | --- |
| Existing branch/worktree, branch 41 read-only, no branch/worktree creation | live Git and user's instruction | PASS for planning only |
| Spec Kit CLI 1.3.0 and non-persisted PathsOnly proof | installed CLI check; feature context required | PASS for planning only |
| Single owner boundaries Identity/DSH/WLT | governance owner drafts + AGENTS.md | TARGET_DESIGN, not implementation |
| Product/semantic cutover | Global NOT_READY; all 26 Product IDs admitted for development | NOT_REQUIRED for journey implementation |
| DSH executable OpenAPI and permissions | paths are exactly empty | NOT_RUN; develop with stage-aware validation |
| DSH SQL, service/identity session contract | no server or SQL implemented yet | NOT_RUN; build on isolated runtime |
| Runtime negative ACL and original-record preservation | no isolated owner-backed deployment | NOT_RUN / REVIEW_BLOCKED where affected |
| Actual Web/Android/iOS customer journey | only Stage4 presentation shells | NOT_RUN |

**Ruling**: Close as We Go authorizes development of this existing Product capability now, without complete 14-owner reconciliation or a separate admission vote. Adapt and test the current Stage-4-only verifier, establish isolated synthetic state and reconcile the material Store/Offer permissions and relevant obligations during this journey. Runtime evidence remains NOT_RUN until actual implementation; no release authority is inferred.

## Project Structure — canonical owners only

- specs/001-customer-store-discovery/: this bounded planning package.
- governance/stores.md, governance/catalog.md, governance/experience.md: canonical decisions are reconciled only for the affected journey as needed.
- services/dsh/contracts/openapi/: one future executable DSH contract and existing reserved domain paths, not a new service.
- services/dsh/backend/: DSH Go owner for this now-admitted development journey after the stage-aware guard is made compatible.
- services/dsh/database/: future reviewed owner migrations and protected upgrade, not donor copy.
- apps/customer/app/: existing Expo screens; add discovery presentation only when owner contract and admission are verified.
- tests/: only true cross-owner integration tests when implementation makes them meaningful.

## Sequencing

1. Reconcile only material Store/Catalog/Identity decisions, original rights and affected consumers for this journey; inventory upstream prerequisites and negative cases. Global governance cutover remains separate and does not block development.
2. Resolve DSH public read contract including eligibility, field allowlist, page/cursor/error semantics and identity boundary. Validate an actual OpenAPI 3.1 document with security/negative contract tests before client generation.
3. Define isolated DSH persistence and authorized read model, with Store/publication and positive exact price checks; preserve historical migration evidence, fresh/upgrade/restore gates.
4. Write RED tests for public discovery, privacy, DIRECT no-marketplace listing, Store/Offer visibility and pagination; implement smallest owner read until GREEN.
5. Generate/reference typed contract client from approved DSH contract; integrate Customer Arabic RTL Web/Android screens and failure/context-switch recovery; no local fact writer.
6. Run genuine owner-backed Web/Android positive and negative journeys, ACL/IDOR/stale-response cases and independent review where required. Keep unrun iOS and financial workflows explicit.
7. Review diff, tests and ownership, then local Commit only under the existing exclusive Git turn without staging others' files. Push requires a separate explicit human authorization; if authorized, verify exact remote SHA and applicable CI. Never create a branch/PR or merge/deploy implicitly.

## Complexity and dependencies

No new packages, caches, parallel Store writers, fake transport endpoints or environment/process supervisors are justified now. Adapt the existing guard for tested progressive service source within this admitted journey, protecting unauthorized operations and unsafe data/permission changes. Do not confuse structural PASS with functional closure.
