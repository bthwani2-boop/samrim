# BThwani local payment-provider simulator

One optional payment-provider test service serves every active wallet provider configured through DSH. The provider key selects the isolated route, reference namespace, and fault scenario. Adding a provider to DSH does not create another container. **This is not a verified real-provider API.**

## Start in local development

From the repository root:

```powershell
docker compose --env-file infra/local/.env -f infra/local/compose/compose.yaml up -d payment-mock
node tools/dev/payment-provider-mock.mjs check
```

Local Compose defaults `WLT_CASH_IN_MODE=wiremock`, unless the private local env explicitly overrides it. When the rebuilt WLT service uses WireMock, it calls `http://payment-mock:8080` internally. The mobile customer and captain select an **active** provider from DSH. DSH validates its configured key and WLT sends requests to the corresponding mock provider endpoint. The mock responds with a simulated terminal outcome; only WLT applies wallet ledger entries and fees.

The default contract returns SUCCESS for payments created with that provider. Each provider can have an independent override:

```powershell
node tools/dev/payment-provider-mock.mjs failure wallet_provider_yourkey
node tools/dev/payment-provider-mock.mjs delayed wallet_provider_yourkey
node tools/dev/payment-provider-mock.mjs http500 wallet_provider_yourkey
node tools/dev/payment-provider-mock.mjs reset wallet_provider_yourkey
```

Available outcomes: `success`, `failure`, `unknown`, `delayed`, `http500`, `timeout`, `invalid`, `reset`, `check`. `check` exercises two test-provider identities, independent outcomes, retries and failure modes; the suite resets its overrides afterward.

The mock is **stateless**: the HTTP wire contract is simulated with deterministic references, but it does not maintain external provider bank accounts or independently reconcile real transfers. Funding intents and canonical ledger transactions live solely in WLT, and an unverified or timed-out provider reply must never credit the wallet.

## Safety and limits

- The mock and its administrative control bind to loopback only; `wiremock` is rejected by WLT outside `BTHWANI_ENV=development`.
- Provider keys are selected by an authenticated DSH actor and validated against active DSH wallet providers; no mobile client may call WLT directly.
- WLT verifies the returned provider identity, reference and transaction format before posting a terminal result. Retries use the same WLT funding intent and idempotent ledger path.
- The legacy `WLT_CASH_IN_MODE=simulator` can still be chosen explicitly for manual development tests.
- Official contracts and sandbox credentials are required **per real provider** before claiming integration with that provider. Production readiness additionally needs real callbacks, signatures, settlement statements and controlled verified test transfers.

No secrets or production data belong in this folder. Do not expose the WireMock Admin API on a public interface.
