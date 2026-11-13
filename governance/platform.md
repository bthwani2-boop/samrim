# BThwani — Actor, Store and Surface Model

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/platform.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Canonical vocabulary
- **Customer:** human who discovers, shops, tracks and communicates about Orders.
- **Merchant:** human with the admitted merchant account/role and zero or more DSH Store ownership or delegated access relationships. `Merchant` is not a synonym for `Store`.
- **Store:** separately identifiable DSH business resource: catalog, availability, publication, service city, owner, commercial terms and fulfillment eligibility; it is not an Identity principal.
- **Captain:** authorized human with operational standing for an admitted Captain role. Platform Captain assignment, Store-Captain membership and possession of a Store employee grant are separate facts.
- **Operator:** authorized human managing bounded platform responsibilities with explicit Identity permissions. Root Owner exceptional actions retain independently reviewable attribution and never imply permanent permission bypass.
- **HR Employee:** internal employee record and bounded access linkage, not an automatic platform superuser.

**One human actor:** Identity keeps one permanent `actor_id` for each natural person. The compatible existing technical role values are `client`, `partner`, `captain`, and `operator`, while the new UI and internal presentation vocabulary uses Customer, Merchant, Captain and Operator. One actor may hold independently admitted roles without duplicate accounts; neither Store ownership nor Store-affiliated Captain membership creates a new high-level role. Role/session authorization remains with Identity, resource delegation with DSH. An employee title or reporting position never grants Operator access. No retired acquisition-agent role, enrollment application, referral-reward engine or independent fifth actor surface is admitted; protect any binding historical records with their original owner.

Use Customer/Merchant/Captain/Operator in **new internal names, route descriptions and UX**. Preserve deployed technical paths, signing identities and public compatibility at an explicit, tested cutover. Existing `partner` names in branch 41 are donor names or historical contract inputs, not a reason to create separate Merchant and Partner actors. No manufactured conversion of existing legal identities.

## Surface model
- Customer Expo app: Android, iOS and Expo Web; compact marketplace Store and one full public Store Web presentation by governed link.
- Merchant Expo app: Store setup and self-management, one or many Store scopes; no additional full-Store customer app.
- Captain Expo app: availability, eligible offers, assignment, delivery and own financial readback.
- Operator Control Panel: currently Next.js and Ant Design; policies, operations, finance, security and design authoring within authorized scope. This UI is an adapter and reader, never the business rule/ledger writer.
- Marketing/site and technical providers: presentations or adapters only, with no extra actor authority or business database.

## Distinct semantics
A Store relation (`MARKETPLACE` / `DIRECT`) is a Store commercial/channel choice, not an Identity role and not a fee model. Fee model (`COMMISSION` / `SUBSCRIPTION`) belongs to WLT agreement policy; collection responsibility is separate; fulfillment modes belong to DSH policy and serviceability.

One account may change Store context without allowing previous Store's data, pending requests or permissions to leak into the next context. Delegated rights are Store-scoped and rechecked by the actual DSH operation, not inferred from local navigation. DSH Store grants are expressly allowlisted, audited, expiry/revocation bounded and owned by the authorized Store owner; they do not introduce a generic Merchant organization or impersonation authority. A Store-affiliated Captain uses one canonical Captain actor with DSH-scoped membership, not a separate account or new role.

**Delivery recipient:** the recipient may differ from the purchasing Customer, but Order delivery-contact details form only a bounded DSH snapshot. They do not create a new Identity account, Customer/Store/Operator role, payment principal or support authority. The purchaser remains the authorized Order/funding principal.

The actor terms above are stable product semantics; exact API/SQL string migration remains an implementation-stage decision and must not create duplicate enum values as independent truths.

## SURFACE-01 — Canonical internal app names versus immutable external identity

**Approved source-placement rule for Stage-4 presentation hosts:** exactly four presentation hosts: `apps/customer` (Customer Expo Android/iOS/Web), `apps/merchant` (the one Merchant Expo app for both `MARKETPLACE` and `DIRECT` Stores), `apps/captain` (Captain Expo), and `apps/control-panel` (Next.js/Ant Operator). Old `apps/app-client`, `apps/app-partner` and `apps/app-captain` remain *donor paths*, not new owners or active target aliases. Earlier design-plan proposal `apps/partner` is superseded for the clean internal folder; no second merchant app is admitted. The four host package manifests are now tracked in the inspected refoundation worktree, but their existence is **structure-only evidence**. Actual business-screen migration, service contracts, data, signed native builds and release acceptance have separate implementation/runtime gates; assess them against the current revision and authorized owner readback, never against this policy table or an obsolete blanket `NOT_RUN` label.

| New internal folder | Donor app key / stable Expo slug | Android application ID + iOS bundle ID | Deep link scheme | EAS project ID from donor `mobile.config.json` |
| --- | --- | --- | --- | --- |
| `customer` | `app-client` | `com.bthwani.client` | `client` | `4adf3184-fc07-4186-b49e-0dc821a5ab73` |
| `merchant` | `app-partner` | `com.bthwani.partner` | `partner` | `bcd22a76-d4b2-4de0-93b3-f6d13074a802` |
| `captain` | `app-captain` | `com.bthwani.captain` | `captain` | `7efa39e1-895f-44d7-a597-d613c79297b6` |
| `control-panel` | Current Next.js Operator Web | No mobile ID in this scope | Current web URLs remain unchanged | Not applicable |

The donor owner slug is `bthwani1` for these three Expo projects; `version` in each inspected `mobile.config.json` is `0.3.1`. These are **source-branch observations** at donor SHA `426d67b47beb8c66b09acd8c7394086b53ac5aae`, not confirmation of published App Store identities or live EAS account entitlements. Signature/keystore, provisioning, OTA runtime versions and private credentials are **not** copied into governance or committed. Validate them only via protected authorized runtime/channel at actual implementation.

Migration must preserve external IDs/slugs/schemes/owners/EAS projects, notification registrations, deep links, public Store URLs, app config plugins, native permissions and session caches. Existing donor `tools/mobile/create-samrim-metro-config.cjs` and `define-samrim-expo-app.cjs` expect old app keys; update those **and** resolved Expo config, Nx/pnpm/Metro/CI/scripts/test consumers in one reviewed conversion, without silently changing published identity or creating parallel aliases. Compare before/after resolved Expo config and verify affected Web/Android/native builds before retiring donor paths. No folder or app is created by this governance clause.
