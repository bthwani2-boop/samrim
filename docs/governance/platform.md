# BThwani Platform Model

ARTIFACT_CLASS: DURABLE_PLATFORM_GOVERNANCE
SEMANTIC_OWNER: docs/governance/platform.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Platform definition

BThwani is one unified multi-surface delivery-commerce Product. Its actor-facing surfaces are hosts for role-specific work and presentation; they are not independent Products, tenants or business-truth owners.

Deployable host names, repository paths, package identities and current runtime composition are implementation truth and do not belong in this semantic owner.

## Human Actor model

One natural person is represented cross-boundary by one permanent `actor_id`.

The current high-level BThwani roles/personas are exactly:

- `client`;
- `partner`;
- `captain`;
- `field`;
- `operator`.

One Human Actor may hold multiple roles. Role admission, credentials and sessions never create a second human identity.

`field` means Partner Acquisition and Onboarding Representative only. It does not create a generic field-operations domain.

`operator` is the human persona for the Operator workspace. First-Operator bootstrap is a one-time Identity lifecycle, not a second role or Product layer.

`partner` means Identity admission to the merchant-side Partner workspace. It does not by itself prove ownership of any Store. Store ownership and bounded Store operational authority are DSH-owned resource relationships. A Partner actor may own one Store, own several Stores, hold an explicit Store-scoped access grant for another Store, or combine those relationships without creating another role or identity.

A Partner Captain is not a sixth Identity role. The Human Actor remains a canonical `captain`; Store-scoped affiliation/membership/eligibility is a DSH-owned relationship around that actor. The same Captain actor may hold multiple permitted relationships without creating duplicate identity.

Detailed role admission/authentication/session semantics belong to `IDENTITY_ACTIVATION_SESSIONS`. Store-scoped Captain relationship semantics belong to `STORE_CAPTAIN_MEMBERSHIP`. Bounded domain ownership belongs to `docs/governance/architecture.md`. Current Product breadth belongs to `docs/governance/product/overview.md`.

Store-scoped delegated access is not a new high-level Identity role. It is an explicit DSH-owned grant from an authorized Store owner to a canonical actor admitted to the Partner workspace where required by the grant lifecycle, with Store scope, an allowlisted permission set, expiry/revocation and audit. It cannot create a generic Partner organization or team hierarchy. The role answers which high-level workspace the actor may authenticate to; the DSH Store relationship answers which Store resources/actions are authorized there.

A delivery recipient may be a person other than the purchasing Client. A recipient snapshot is bounded delivery-contact data attached to the Store Order; it does not create a Human Actor, role, account, payment authority or support authority. The purchasing Client remains the Order/payment principal.

## Surface model

A Surface is an actor-facing deployable presentation/composition host for admitted Product work.

The five actor-facing surfaces are Client, Partner, Captain, Field and Operator. A Surface may own its shell, navigation, composition, transient presentation state and platform adapters. It never becomes the canonical owner of the business facts it renders or mutates.

Brand unity does not imply identical information architecture or shell across roles.

## Canonical terms

- **Human Actor** — one natural person represented by `actor_id`.
- **Role** — high-level Identity admission such as client, partner, captain, field or operator.
- **Surface** — actor-facing presentation/composition host; never a business owner by itself.
- **Partner** — authenticated Human Actor with the `partner` role; Store authority is separately determined by DSH ownership/grants.
- **Captain** — authenticated Human Actor with the `captain` role; operational relationships are separate DSH facts.
- **Store** — DSH business resource belonging to a Partner owner; not a tenant or Human Actor.
- **Store ownership** — DSH resource relationship establishing owner authority for one Store.
- **Store Captain Membership** — DSH-owned Store-scoped relation between a Store and canonical Captain actor; not a role.
- **Store-scoped access grant** — DSH-owned bounded permission grant within one Store for an appropriately admitted Partner-workspace actor; not a role, tenant or generic team membership.
- **Delivery recipient** — bounded Order delivery-contact snapshot; not an account/role or Order/payment principal.
- **Joining Case** — DSH Partner-onboarding workflow; never a second Partner identity.
- **Canonical owner** — bounded owner of durable meaning and authoritative mutation.
- **Canonical readback** — owner-backed observable committed state after mutation.
- **Derived projection** — rebuildable/read-optimized state with no mutation authority.
