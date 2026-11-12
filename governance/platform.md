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

Use Customer/Merchant/Captain/Operator in **new internal names, route descriptions and UX**. Preserve deployed technical paths, signing identities and public compatibility at an explicit, tested cutover. Existing `partner` names in branch 41 are donor names or historical contract inputs, not a reason to create separate Merchant and Partner actors. No manufactured conversion of existing legal identities.

## Surface model
- Customer Expo app: Android, iOS and Expo Web; compact marketplace Store and one full public Store Web presentation by governed link.
- Merchant Expo app: Store setup and self-management, one or many Store scopes; no additional full-Store customer app.
- Captain Expo app: availability, eligible offers, assignment, delivery and own financial readback.
- Operator Control Panel: currently Next.js and Ant Design; policies, operations, finance, security and design authoring within authorized scope. This UI is an adapter and reader, never the business rule/ledger writer.
- Marketing/site and technical providers: presentations or adapters only, with no extra actor authority or business database.

## Distinct semantics
A Store relation (`MARKETPLACE` / `DIRECT`) is a Store commercial/channel choice, not an Identity role and not a fee model. Fee model (`COMMISSION` / `SUBSCRIPTION`) belongs to WLT agreement policy; collection responsibility is separate; fulfillment modes belong to DSH policy and serviceability.

One account may change Store context without allowing previous Store's data, pending requests or permissions to leak into the next context. Delegated rights are Store-scoped and rechecked by the actual DSH operation, not inferred from local navigation.

The actor terms above are stable product semantics; exact API/SQL string migration remains an implementation-stage decision and must not create duplicate enum values as independent truths.
