# Plan — Customer Store and catalog discovery

Follow [spec.md](spec.md), the canonical domain owners and [AGENTS.md](../../AGENTS.md). Reconcile actual current contracts and valid prior evidence before changes.

1. Trace DSH public discovery in [discovery](../../services/dsh/backend/internal/discovery), existing [OpenAPI](../../services/dsh/contracts/openapi/dsh.openapi.yaml), generated clients and the Customer [Store surfaces](../../apps/customer/src/features/stores). Keep one owner query/visibility boundary; verify actual publication/channel, eligibility, exact price, field allowlist, bounded filters/cursors and negative cases.
2. Verify current Customer Store/detail/storefront presentation, authoritative availability, old-response rejection, empty/loading/error/retry, accessibility and public link/deep-link behavior. No new framework or local truth writer.
3. Reuse DSH [favorite owner](../../services/dsh/backend/internal/customercart/favorites.go), current SDK and existing Customer [discovery features](../../apps/customer/src/features/discovery). Verify actor/scope, visibility, bounded keyset, same desired-state replay and unknown-outcome readback.
4. Use the existing [cart screen](../../apps/customer/src/features/cart/cart-screen.tsx) and versioned DSH replacement; prove confirmation, cancellation, stale snapshot invalidation and explicit same-operation recovery.
5. Run applicable native owner tests, real isolated PostgreSQL and HTTP, strict contract/client parity, affected Web/Android, negative security and runtime evidence. Baseline-first owner schema only; retained-data upgrades require separate authority. Deliver tested owned scope via native Git, verify exact remote and CI; acceptance remains with the existing owner.

Prior plans and execution evidence remain at the [immutable historical tree](https://github.com/bthwani2-boop/samrim/tree/f0934d9c73acfbef042c818a600d4e4b32ccf0ac/specs/001-customer-store-discovery). Do not revive retired stages, reserved empty fragments, historical staffing or delivery rules.
