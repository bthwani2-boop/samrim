# BThwani Governance

ARTIFACT_CLASS: DURABLE_GOVERNANCE_INDEX
SEMANTIC_OWNER: docs/governance/README.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Authority
Human authorization sets mutation scope; live code/contracts/runtime prove implementation. Governance states durable approved product, architecture and policy decisions. Working documentation and historical references are not parallel authority.

## Canonical documents

The durable Product root is `docs/governance/product.md`; the bounded ownership root is `docs/governance/architecture.md`. This index contains routes, not duplicate business decisions.
- platform.md — actors, roles, surfaces, terminology.
- architecture.md — Identity, DSH, HR and WLT bounded owners and single-engine law.
- product.md — admitted capabilities, product boundaries and non-goals.
- identity.md — Identity admission, credentials, sessions, permissions.
- stores.md — canonical Store, onboarding, relation model, publication, Store access and availability.
- catalog.md — shared and Store-local catalog, categories, offers and customer read model.
- commerce.md — addresses, carts, checkout, Orders, promotions and conversations.
- fulfillment.md — dispatch, Store-Captain affiliation, handoff, delivery and pickup.
- finance.md — WLT policy, Store agreements, commissions, subscriptions, payments and settlements.
- hr.md — BThwani employee lifecycle and HR-owned facts.
- experience.md — design, Arabic RTL, navigation, accessibility and recovery.
- safety.md — security, data, persistence, idempotency and resilience.
- engineering.md — quality, delivery, integrations, scaling and evidence.
- journeys.md — cross-owner end-to-end scenarios and integration boundaries.

Every admitted CAPABILITY_ID in product.md has exactly one section in one domain-owner document above. A section ID is not a separate service or semantic owner. Cross-cutting rules belong to the one best-fit document.

## Current refoundation execution plan (non-authoritative)

- `docs/governance/BTHWANI-FULL-SYSTEM-REFOUNDATION-PLAN.md` — owner only of the requested refoundation plan and dated initial audit snapshot. It is not a second Product/System/Policy authority, does not supersede the canonical owners above, and grants no deletion, reset, publication or Git operation permission.

## Authority and simplicity law
ONE MATERIAL MEANING → ONE EDITABLE GOVERNANCE OWNER.
ONE MATERIAL MUTABLE FACT → ONE CANONICAL SERVICE WRITER.
ONE ESSENTIAL OPERATION → ONE CANONICAL ENGINE.
ONE EXTERNAL CONTRACT → ONE EXECUTABLE PROVENANCE.
A Store relation, UI mode, public link, feature policy, historical case or provider cannot establish another Store/catalog/checkout/financial owner.

A document or rule survives only if it has unique present durable meaning at the correct owner. Preserve legal/financial historical evidence in its canonical service and Git history, not as a competing current lifecycle. Do not delete working consumers or persisted records as a shortcut to removing duplicated policy text.
