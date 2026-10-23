# Payment-provider HTTP simulator (development only)

This is a **provider-neutral mock contract**, not an undocumented API specification for any Yemeni wallet provider.

From the repository root, start only this optional service without restarting the platform:

```powershell
docker compose -f infra/local/compose/compose.yaml --profile payment-mock up -d payment-mock
node tools/dev/payment-provider-mock.mjs check
```

Default WLT remains `WLT_CASH_IN_MODE=simulator`. To opt into the HTTP boundary in local development, set `WLT_CASH_IN_MODE=wiremock` and `WLT_PAYMENT_MOCK_BASE_URL=http://payment-mock:8080` for WLT, then apply the configuration deliberately; do not restart an active wallet service just to run mock-only tests.

Switch the mock provider's answer without changing wallet data:

```powershell
node tools/dev/payment-provider-mock.mjs success
node tools/dev/payment-provider-mock.mjs failure
node tools/dev/payment-provider-mock.mjs unknown
node tools/dev/payment-provider-mock.mjs delayed
node tools/dev/payment-provider-mock.mjs http500
node tools/dev/payment-provider-mock.mjs timeout
node tools/dev/payment-provider-mock.mjs reset
```

`check` runs HTTP contract smoke tests against the mock only; it does not create WLT ledger entries. Go `internal/cashin` tests exercise the same shape using in-memory HTTP tests. Once a provider supplies official API documentation, implement its actual contract and run against the provider's sandbox; after approval, reconcile controlled real transactions.

**Safety:** Admin API binds to loopback, synthetic references only, and WLT refuses `wiremock` outside `BTHWANI_ENV=development`. Never copy production credentials or real customer data into the mock.
