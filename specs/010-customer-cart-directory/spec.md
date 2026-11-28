# Customer-owned cart directory

Derived CART_CHECKOUT increment, precursor to MULTI_STORE_CHECKOUT. Authority: [commerce](../../governance/commerce.md).

An authenticated Customer finds nonempty saved Store drafts, including an unavailable Store draft, and opens each existing cart for current review. A draft is not an Order, quote or payment. No combined checkout is admitted.

- AC1: GET list actor derives only from current Identity authority; deny anonymous, non-Customer, malformed query, stale authority and cross-actor access.
- AC2: DSH read-only repeatable snapshot of existing customer_carts and lines, excluding empty carts; deterministic bounded page and validated exclusive Store ID cursor. Store name only if public and city/vertical active; no duplicate Store, mutation or database.
- AC3: OpenAPI/derived client agree; reject malformed, non-owner or stale responses; Web BFF verifies cookie session/scope before and after, Native uses existing owner verification.
- AC4: Existing multi-store-checkout entry lists actual drafts with loading/empty/retry; hides on actor loss/expiry/background; existing per-Store cart navigation and accessible account entry. No synthetic rows, combined total, confirmation, stock or fund mutation.
- AC5: Real isolated PostgreSQL isolation, empty/unpublished drafts and paging, negative HTTP/SDK/BFF/UI, actual authorized Web/Android and applicable technical quality/security assessment.

No new policy, table, grant, payment effect, order state or provider. Actual order creation requires its separate owner contracts and acceptance.
