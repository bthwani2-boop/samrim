# WLT client boundaries

`@bthwani/wlt` provides the Customer balance and recent posted funding reads to
the app's Web server adapter and explicitly configured isolated Android emulators. Customer wallet and Merchant commercial-agreement reads use the same native admission in validation.ts: only Android emulators with distinct Identity and WLT host-loopback origins are admitted before session access. Physical devices, iOS, absent or invalid configuration remain closed. It sends the existing opaque session to the WLT loopback owner. The Android preview uses only the emulator-to-host `10.0.2.2` alias. Identity/actor/role, session expiry and the protected device bearer are rechecked before and after each owner read; missing configuration stays closed. The finance SDK has no money writer and Native Cash-In remains unavailable.
The shared response validator keeps whole YER as decimal text and checks
the returned actor, currency, amount, transaction identity and timestamp shape.
The SDK refuses undisclosed extra provider fields; funding history is capped to
ten entries per page. `hasMore` and `nextCursor` enable validated older-page
requests without account selection, cross-role data reuse or automatic retries.

Generate the method and path index from the owner contract with
`node tools/dev/generate-openapi-operations.mjs wlt`. The [contract](../contracts/openapi/wlt.openapi.yaml)
defines the supported statuses and response fields.

## Source module placement

`clients/index.ts` is the stable public export boundary of `@bthwani/wlt`. `types.ts` contains the read DTOs; `errors.ts` and `validation.ts` contain the existing bounded error and field checks. `transport.ts` owns the isolated loopback GET response handling. `wallet-balance.ts` parses and reads Customer balance; `funding-history.ts` parses and reads bounded funding history, including exact UTC keyset cursor validation. The contract-derived operation index stays in `generated/wlt-operations.ts`. This is only a source organization change: WLT remains the sole financial writer and the SDK remains read-only.
