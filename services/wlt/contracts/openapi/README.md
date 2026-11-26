# WLT OpenAPI

`wlt.openapi.yaml` is the owner entrypoint. It references Customer balance
and funding-history reads in `paths/wallets.yaml`. These require a current
Customer bearer verified by Identity and return exact posted YER as decimal
text. `paths/runtime.yaml` describes the existing isolated `/health` probe:
PostgreSQL reachability and, in container mode, Identity health. Its empty
200/503 responses do not establish financial or production readiness.
Future financial operations require actual owner contracts; historical reserved group names remain in the donor inventory, not empty executable files.

Run `pnpm check:contracts` to validate local references, operation security
and generated method and path metadata. The PostgreSQL owner suite exercises
the live Go handler and active Identity verifier on synthetic data.
