# BThwani — Actor, Store and Surface Model

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/platform.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

This owner defines actor and surface terminology, distinct resource identities and protected external application identities. Business capabilities belong to [Product](product.md) and their domain owners; [architecture](architecture.md) owns data/writer boundaries, [repository structure](../REPOSITORY-STRUCTURE.md) owns source placement, and [experience](experience.md) owns rendering and interaction.

## Canonical vocabulary

| Concept | Meaning |
| --- | --- |
| Customer (عميل) | Human who discovers, purchases, tracks and communicates about Orders |
| Merchant (تاجر) | Human with admitted Merchant role and zero or more DSH Store ownership/delegation relationships |
| Store (متجر) | Separately identified DSH resource with relation, catalog, publication, serviceability, availability and independently owned financial/fulfillment eligibility; not an Identity principal |
| Captain (كابتن) | Human with admitted Captain role; platform standing, Store affiliation and employee grants are independent facts |
| Operator (مشغّل) | Human with bounded explicit Identity permissions; exceptional Root Owner actions require attributable proof, never permanent bypass |
| HR Employee | Scoped employment record and access linkage; not a global principal role or automatic permission |

Identity owns one stable actor_id per natural person. Its current principal roles are customer, merchant, captain and operator. One actor may hold independently admitted roles; role, session, Store ownership, Store membership, employment and Operator scopes never imply one another. No retired acquisition-agent role, separate enrollment app, referral reward writer or fifth actor surface is admitted; preserve lawful binding historical records at their actual owners.

## CUSTOMER_MERCHANT_CANONICAL_TERMS — Binding naming and ownership rule

Use Customer/Merchant and lowercase customer/merchant for the same concepts in new folders, components, routes, Identity roles, APIs, SQL and Operator permissions. Do not introduce client, partner, partners, app-client or app-partner as new aliases for those concepts, or conflate Store with Merchant. The legacy identifiers that preserve donor evidence, protected external identities or expressly documented compatibility may remain only for that purpose, never as new authorization. The existing Operator merchant scope is not an Identity Merchant role, Store grant or right to another Merchant's data.

Identity owns admission, actor/session and Operator permission checks; DSH owns Store identity, relation, scoped delegation, catalog, Orders and publication; WLT owns financial agreements and money. An admitted Customer may become Merchant with the same actor_id. Neither role nor merchant permission implies private Customer data, unrelated Store access, payout control or impersonation.

A role or scope rename is accepted only with all actual SQL constraints and applied histories, Identity verifiers, API/client contracts, grants, Operator guards, app routes/UX, tests and current runtime consumers reconciled together. Preserve actor IDs, existing permissions, sessions and protected audit history. A new empty disposable schema may use canonical identifiers; retained schema changes need the authorized compatible upgrade/recovery under [SQL-01](engineering.md#sql-01--safe-one-baseline-per-owner-fresh-bootstrap-protected-upgrades). Tests must reject old aliases as new grants, verify the same actor with independently scoped roles, deny unrelated/revoked access, and prove affected Web/Android session and route isolation with owner readback. Labels and navigation visibility are not authorization.

## Surface model

| Surface | Responsibility |
| --- | --- |
| Customer | Expo Android/iOS/Web; compact marketplace Store view and one full public Store Web presentation under a governed link |
| Merchant | One Expo app for Store setup and self-management, across eligible Stores and both relations |
| Captain | Expo availability, offers, assignment, delivery and own financial readback |
| Operator | Next.js/Ant Design Control Panel for bounded policy, operations, finance, security and design authoring |
| Marketing/site and technical providers | Presentation or technical adapters, never an additional actor authority or business database |

Current source paths are defined by [repository structure](../REPOSITORY-STRUCTURE.md). No second Merchant Web backend, separate full-Store Customer application or duplicate actor host. Actual capability scope and acceptance remain progressive under [Product](product.md) and [engineering](engineering.md).

## Distinct semantics

Store relation MARKETPLACE/DIRECT governs channel, not Identity role, WLT fee model, collector or DSH fulfillment mode; see [Store](stores.md), [finance](finance.md) and [fulfillment](fulfillment.md). A change of Store/account context invalidates prior private reads, pending responses and grants; DSH rechecks allowlisted Store-scoped, auditable, expiry/revocation-bounded delegation at the actual operation. No generic Merchant organization or impersonation authority. Store-affiliated Captains use the same Identity actor with DSH-scoped membership.

Delivery recipient may differ from purchasing Customer. Its purpose-limited contact is a DSH Order snapshot, not a separate account, support authority, role or payment principal. Purchaser remains the authorized Order/funding principal. Identifier evolution preserves the historical fact type and actual owner under [architecture](architecture.md).

## SURFACE-01 — Canonical internal app names versus immutable external identity

Exactly four actor presentation hosts are admitted. The current approved external identities are protected invariants, not discretionary values inferred from folder names. The actual app config and [registered identity check](../tools/mobile/verify-app-identity.mjs) must agree with them.

| Internal host | Expo slug | Android app ID and iOS bundle ID | Deep-link scheme | EAS project ID |
| --- | --- | --- | --- | --- |
| customer | customer | com.bthwani.customer | customer | 9b97c906-0dfc-4cf7-8d2b-079593523dc7 |
| merchant | merchant | com.bthwani.merchant | merchant | c56092bf-d41b-4944-a28c-de227b3d8e8a |
| captain | app-captain | com.bthwani.captain | captain | 7efa39e1-895f-44d7-a597-d613c79297b6 |
| control-panel | Next.js Operator Web | No mobile identity | Existing web URLs | Not applicable |

**2026-11-17 approved development registration:** Customer and Merchant use independent new EAS projects. The prior identities below remain protected for installed-client compatibility, recovery and audit, not alternate active apps. Registration did not authorize or prove a signed build, store release, live account entitlement, Firebase/Maps/push setup or signing continuity.

| Preserved historical Expo project | Android/iOS ID | Scheme | Historical EAS ID |
| --- | --- | --- | --- |
| @bthwani1/app-client | com.bthwani.client | client | 4adf3184-fc07-4186-b49e-0dc821a5ab73 |
| @bthwani1/app-partner | com.bthwani.partner | partner | bcd22a76-d4b2-4de0-93b3-f6d13074a802 |

Read-only donor SHA 426d67b47beb8c66b09acd8c7394086b53ac5aae records donor owner bthwani1 and observed mobile.config.json version 0.3.1. It is historical source evidence, not live EAS or store registration proof. No credentials, keystore, provisioning or private signing material belongs in this document.

External ID, slug, scheme, account/project, signing, OTA runtime, notification registration, deep-link, public Store URL, app config/plugin, native permissions or session migration requires specific authority, exact current source/registered identity proof and compatible consumer cutover. Compare resolved before/after Expo configuration, actual Nx/pnpm/Metro/CI/script/test consumers and affected real Web/Android/native binaries; preserve existing installations and lawful data. Retire old source aliases only after proven transition. The current configuration owner is the actual [Expo config helper](../tools/mobile/define-bthwani-expo-app.cjs) and each app config, not obsolete donor helper paths. No policy table, source manifest or structure check proves a signed binary, runtime journey or release permission.
