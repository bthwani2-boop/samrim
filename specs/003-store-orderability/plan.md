# Implementation Plan — Store Orderability

**Source of truth**: `governance/stores.md` and `governance/journeys.md`; Spec Kit is derived work guidance only.
**Branch**: `refoundation/clean-house-20261112`.
**Collision avoidance**: Session 01 owns `CUSTOMER_STORE_CATALOG` including DSH discovery, current Store bootstrap migration, customer discovery views, and shared Go manifest. Session 02 owns `internal/storeavailability`, its subsequent migration and Merchant/Operator surfaces. Shared OpenAPI root, Store contract, Go manifest, app entrypoints and Git index require sequential peer coordination.

## Implementation path

1. Verify Store authorizing facts from actual DSH Store and delegated grants, Identity current session and Operator scope; distinguish published discovery and availability facts.
2. Build derived orderability evaluator and adversarial schedule validation under the DSH service owner, independent of transport and display. Make unit tests fail first and pass after implementation.
3. Add a forward-only DSH migration for the operational facts referencing the **same** DSH Stores from session 01, with per-Store schedule and method eligibility independent, version and operation-ID audit; review the existing `operational_state` overlap before modifying or applying shared SQL.
4. Integrate a single DSH API and OpenAPI/client contract with actual Identity verified sessions and store-scope checks, typed stable error responses, idempotent updates and reconciliation reads. No parallel owner or UI-side mutation authority.
5. Add Merchant/Operator editing and Customer safe readback using existing Expo/Tamagui and Next/Ant Design source; verify RTL and delayed response invalidation.
6. Verify synthetic isolated owner-backed PostgreSQL and networked multi-actor Web/Android journeys, fail, retry and race; only then commit with exclusive `tools/dev/git-turn.mjs` and authorized Push.
7. Close independent technical/business and engineering/security reviews only with checks tied to the exact final SHA; production remains BLOCKED.

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
