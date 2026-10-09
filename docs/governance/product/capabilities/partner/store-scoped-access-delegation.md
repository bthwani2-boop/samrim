# Store-Scoped Access Delegation

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/store-scoped-access-delegation.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_SCOPED_ACCESS_DELEGATION

## Outcome

An authorized Store owner may invite a canonical Human Actor into bounded Partner-workspace access for one or more owned Stores and grant/revoke an allowlisted set of operational permissions without creating a sixth Identity role, a generic Partner organization, a separate Staff application or a multi-tenant team system.

## Ownership

DSH owns Store-scoped invitation/grant lifecycle, Store scope, allowlisted permissions, acceptance, suspension/revocation and canonical operational readback. Identity owns the Human Actor, verified phone, `partner` role admission, credentials and Partner role-scoped sessions. WLT remains the independent owner of financial authority and may reject delegated financial intent according to Finance policy.

## Surface/session contract

Owners and delegated Store staff use the same Partner application and a `partner` role-scoped session. The role means admitted access to the merchant-side Partner workspace; it does not imply Store ownership. DSH independently authorizes every Store action from Store ownership or an active accepted StoreAccessGrant.

Normal user-facing invitation starts from a phone number, not an `actor_id`, Store code or other technical identifier. DSH/Identity resolve the canonical Human Actor behind that boundary. Resolution must fail closed when the phone does not resolve uniquely to one eligible canonical actor. A UI role preset is only a convenient bundle of bounded DSH permissions; it never becomes a new Identity role or independent RBAC authority.

A Store owner cannot grant the `partner` role directly. The governed path is:

```text
STORE OWNER
→ phone-based Partner-surface invitation
→ DSH resolves canonical Human Actor + requested Store scopes/permissions
→ invitation acceptance
→ DSH establishes Partner-workspace eligibility when required
→ authorized Identity partner-role admission when needed
→ actor activates/authenticates Partner role
→ DSH commits accepted StoreAccessGrant(s)
→ Partner surface exposes only authorized Store scope and functions
```

One owner action may target several owned Stores, but canonical authority remains Store-scoped: the system persists attributable Store grants rather than one opaque organization-wide permission.

## Permission model

The allowlist may include only currently admitted operational responsibilities, including where implemented: Orders, Catalog/StoreOffer, Store operations, promotions, fulfillment/Store-Captain work and bounded financial read/request intents governed by WLT policy.

Permission bundles such as Store Manager, Order Staff, Catalog Staff, Accountant or Delivery Staff are UX presets over this allowlist. Custom selection, when exposed, remains bounded to the same canonical permissions. The user-facing permissions may cover Orders read/manage, Catalog read/manage, Store operations, promotion management, finance read/report, payout-intent request and admitted fulfillment/Store-Captain operations. DSH enforces each grant per Store; WLT independently authorizes financial read and intent against the same Store scope. A payout-intent permission never changes the payout recipient.

The Partner owner alone may assign, change or reconfirm a Store payout recipient. That owner-only routing authority is not a delegable permission and is distinct from the ability to read financial information or request a payout. Team invitation, grant changes, suspension and revocation remain owner-managed in the current scope.

Role presets remain presentation bundles rather than backend authorities. Their normal mappings are bounded: Store Manager receives the admitted operational scopes; Order Staff receives Orders; Catalog Staff receives Catalog and only explicitly granted promotion management; Accountant receives finance read/report and receives payout-intent request only when separately granted; Delivery Staff receives only admitted fulfillment/Orders scopes.

## Invariants

- every canonical invitation/grant references one Store and one canonical actor, even when a user action creates equivalent grants for several Stores;
- a Store grant never creates a new high-level role and never grants access through a Captain/Field/Operator session;
- only the authorized Store owner may create/change/revoke Store staff grants under the current scope;
- the invited actor must accept before delegated authority becomes active;
- normal Partner UX never requires or exposes raw Actor IDs as the invitation mechanism when human-readable identity is available;
- permissions are an explicit finite allowlist, versioned and attributable; a grant cannot self-expand or grant owner-level authority;
- Partner role/session and DSH Store authorization are both required; possession of either one alone is insufficient;
- a delegated actor cannot cross Store scope or mutate another owner's facts;
- aggregate or multi-Store views never weaken object-level Store authorization;
- financial request/approval/execution/reconciliation remain subject to WLT policy and cannot be bypassed by a Store grant;
- revocation/suspension stops future access without rewriting historical actions;
- no generic organization, department, team hierarchy, tenant semantics, shared-owner credential or separate Staff app is introduced.

## Failure and recovery

Unknown, unresolved or ambiguous phone/actor, declined/expired invitation, unauthorized owner, duplicate invitation/grant, stale version, cross-Store request, revoked access, conflicting permission update, interrupted role admission and ambiguous mutation converge on one DSH grant truth plus Identity role/session truth. Retry cannot create a second actor, second effective Store grant or broader permission set.

## Proof boundary

Proof requires phone-based invitation, invitation acceptance, Partner-role activation where needed, positive authorized Store access, negative unrelated/cross-Store access, function-level denial, self-escalation denial, revocation readback, no access through a non-Partner session, no raw Actor-ID dependency in normal UX and preservation of WLT financial boundaries.
