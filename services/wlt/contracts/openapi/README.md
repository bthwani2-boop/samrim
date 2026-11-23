# WLT OpenAPI

`wlt.openapi.yaml` is the owner entrypoint. It references the Customer
balance read in `paths/wallets.yaml`. The read requires a current Customer
bearer verified by Identity and returns exact posted YER as decimal text.
The remaining path groups reserve names for future financial contracts.

Run `pnpm check:contracts` to validate local references, operation security
and generated method and path metadata. The PostgreSQL owner suite exercises
the live Go handler and active Identity verifier on synthetic data.
