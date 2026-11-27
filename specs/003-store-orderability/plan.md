# Implementation Plan — Store Orderability

**Source of truth**: `governance/stores.md` and `governance/journeys.md`; Spec Kit is derived work guidance only.
**Historical creation branch**: `refoundation/clean-house-20261112`; resolve live authorized checkout per [AGENTS.md](../../AGENTS.md).
**Ownership and collaboration**: Discover actual current DSH discovery, Store availability, owner SQL, shared contracts and application writers before editing. Isolate real conflicts only; coordinate shared resources under [AGENTS.md, section 5](../../AGENTS.md#5-execution-and-concurrency), without fixed historical session assignments.

## Implementation path

1. Verify Store authorizing facts from actual DSH Store and delegated grants, Identity current session and Operator scope; distinguish published discovery and availability facts.
2. Build derived orderability evaluator and adversarial schedule validation under the DSH service owner, independent of transport and display. Make unit tests fail first and pass after implementation.
3. Add a forward-only DSH migration for the operational facts referencing the **same** DSH Stores from session 01, with per-Store schedule and method eligibility independent, version and operation-ID audit; review the existing `operational_state` overlap before modifying or applying shared SQL.
4. Integrate a single DSH API and OpenAPI/client contract with actual Identity verified sessions and store-scope checks, typed stable error responses, idempotent updates and reconciliation reads. No parallel owner or UI-side mutation authority.
5. Add Merchant/Operator editing and Customer safe readback using existing Expo/Tamagui and Next/Ant Design source; verify RTL and delayed response invalidation.
6. Verify synthetic isolated owner-backed PostgreSQL and networked multi-actor Web/Android positive, failure, retry and race behavior as applicable. Deliver each complete tested owned foundation immediately using [AGENTS.md, section 7](../../AGENTS.md#7-git-delivery); full journey acceptance remains separate.
7. Complete applicable executor technical and engineering/security assessment under [AGENTS.md](../../AGENTS.md), preserving required human business approvals and checks tied to the exact final SHA; production remains BLOCKED.

## Owner-backed city limits slice (2026-11-15)

- The effective Store pause/preparation bounds come from a single DSH city policy table with a version; an unprovisioned or inactive city fails closed. The migration neither seeds an unapproved policy nor grants merchant/operator capabilities. Operator Policies versioned/audited writer and UI remain separate pending the actual Identity service.
- A Store mutation carries the version read from DSH. The DSH Store writer checks that version and both bounds again inside its serializable transaction while holding the policy row lock. The immutable Store audit retains the used policy version; historical audit rows remain NULL instead of gaining fabricated policy revisions.
- Synthetic owner PostgreSQL Linux test covers missing city policy, stale policy, new bounds, concurrent same-key replay, seven audit rows with versions 1 and 2 and durable version 8. It does **not** validate a real authenticated Operator Policies update or checkout.

## Identity session adapter slice — 2026-11-15

- DSH has a bounded, uncached HTTP transport adapter to Identity's reviewed `GET /v1/sessions/current` response (`actorId`, lowercase `role`, `sessionExpiresAt`). The adapter does not manufacture a session, impersonate an actor, cache an earlier identity, or follow a redirect with an opaque bearer secret. Unexpected, expired, revoked or unavailable owner responses fail closed. A network/owner outage maps to a recoverable 503 instead of incorrectly logging out a valid user.
- The real Identity permission grant for the Operator `operations` action is not yet exposed, so `RequireOperatorPermission` deliberately denies the Operator even when the actor's role is `operator`. Merchant reads/changes still require current DSH Store ownership. The DSH protected router is still unmounted; no customer/merchant/operator E2E or actual Identity+DSH owner integration is claimed. Transport tests use local HTTP responses, not real Identity persistence.

## Current limits## Security implementation and evidence — 2026-11-15

- DSH availability repositories and grants use one scope-bound transaction for every PostgreSQL operation, including replay readback. The scope is a validated Store schema applied with a bind parameter through `pg_catalog.set_config`, with `pg_catalog` before the Store schema and `pg_temp` last. No dynamic schema name is formatted into SQL statements, and no connection-scoped `SET` can persist into a pooled caller.
- Real synthetic owner PostgreSQL tests cover cross-schema failure, temporary-relation shadow resistance, unchanged pooled `search_path`, real Store-grant and timezone readback, concurrent same-key single mutation/replay and exactly-once audit. Source/commit SHA must be confirmed after Git delivery.
- This only addresses schema scoping and injection static analysis. Real Identity, DSH Operator Policies, checkout/financial admission and actual UI integration remain blocked; independent security/business approval remains `REVIEW_BLOCKED`.



The target candidate is at scaffold stage. The concurrent public Store schema is not stable yet, and Identity current-session verifier / DSH checkout are not implemented. Develop independently testable code first; mark unrun cross-owner and final tests NOT_RUN, never infer PASS from pure code or mock.


## Historical operational-policy comparison and draft reuse increment

The active checkout, not the historical branch label above, supplies the candidate. Reuse CityPolicyHistory, PoliciesWorkspace and city-policy-command; no new HTTP operations, SQL, client cache or policy engine. Pass the verified current city policy into the history component; display historical/current values only when the current version is strictly newer and same-city. Offer a draft action only when the parent is ready, and recheck scope/version and command state in the parent before copying the two limits and clearing the reason. Preserve the existing command path and failure behavior. Test the parent and history rendering with the existing Node/SWC harness before implementation; run typecheck, Biome and applicable browser/owner tests; verify no PATCH on copying and deny stale/mismatched history.

Keep a history of owner cursors in the keyed city history view. Each navigation reads the owner again. Reuse the requested cursor for retry and remove old rows during pending or failed reads.

## BTH-15 delivery policy write
Reuse service_city_delivery_policies, the existing DSH policy router and tariff validation. Add an immutable command/snapshot log in the fresh baseline, lock city row and compare version in one transaction, reconcile ambiguous commit by same actor/key/payload. Expose PATCH through owner OpenAPI, generated operation, typed client, same-origin BFF and existing policy preview form; require reason and independent owner readback. Prove isolated baseline, concurrent/replayed writes, current checkout estimate and rejection paths before runtime acceptance. No protected schema change.

## Fulfillment policy prerequisite
Reuse DSH PostgresPolicySource and the existing Operator city policy router; one append-only city/relation version table serves both current policy (latest version) and stable operation readback, no current-state duplicate. Serialize city writes, validate exact subsets, bind expected version/actor/reason/modes and reject mutation of prior versions. Use fresh isolated baseline, generated OpenAPI operation references and typed SDK. Operator UI and per-Store/checkout/WLT integration use this same owner in subsequent coherent increments; do not activate a mode solely from this policy. No retained-database upgrade or production activation.
