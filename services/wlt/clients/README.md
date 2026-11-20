# WLT client boundaries

`@bthwani/wlt` provides the Customer balance and recent posted funding reads to
the app's Web server adapter. It sends the existing opaque session to the WLT loopback owner.
The shared response validator keeps whole YER as decimal text and checks
the returned actor, currency, amount, transaction identity and timestamp shape.
The SDK refuses undisclosed extra provider fields; funding history is capped to
ten entries per page. `hasMore` and `nextCursor` enable validated older-page
requests without account selection, cross-role data reuse or automatic retries.

Generate the method and path index from the owner contract with
`node tools/dev/generate-openapi-operations.mjs wlt`. The [contract](../contracts/openapi/wlt.openapi.yaml)
defines the supported statuses and response fields.
