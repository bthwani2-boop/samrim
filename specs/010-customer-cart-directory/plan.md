# Plan — Customer-owned cart directory

Reuse DSH customercart/cart_directory.go, owner OpenAPI and derived customer-cart-directory client, existing cart-directory BFF/transport and account/cart navigation. Actor derives from verified Identity. Use existing database role/schema, read-only bounded snapshot, no-store response and stable keyset; no new table, aggregate, dependency or order writer.

Verify contract/client compatibility, cookie-only Web and Native admission. Risks: cross-actor disclosure, stale grants, unpublished name leak, invalid cursor, focus/expiry race and false checkout claims. Test denial/readback and current visibility. Preserve source-only rollback and protected state.

Use native pre-edit/affected checks, actual isolated PostgreSQL, Go, SDK/BFF/UI, contracts, uncached type/lint and authenticated Web/Android; assess applicable security risk. Actual order confirmation is a distinct cross-owner increment.
