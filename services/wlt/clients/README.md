# WLT client boundaries

`@bthwani/wlt` provides the Customer balance read to the app's Web server
adapter. It sends the existing opaque session to the WLT loopback owner.
The shared response validator keeps whole YER as decimal text and checks
the returned actor, currency and amount shape.

Generate the method and path index from the owner contract with
`node tools/dev/generate-openapi-operations.mjs wlt`. The [contract](../contracts/openapi/wlt.openapi.yaml)
defines the supported statuses and response fields.
