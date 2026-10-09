# Services

Canonical bounded-context services live here. Each service owns a distinct
system responsibility and its executable runtime, durable writers, contracts,
data evolution, and verification only when those responsibilities are real.

Service roots:

- `services/identity`
- `services/dsh`
- `services/wlt`

A service directory is not a promise that every possible capability room
exists. Only proven responsibility rooms are materialized. Do not create
generic `shared`, `common`, `core`, `utils`, compatibility, or actor-shaped
service containers.

A service may own backend runtime, canonical writers, service-owned contracts, generated/public clients, durable database evolution, service-owned reusable presentation, and service-level verification only when those responsibilities are proven.

Service-to-app dependency is forbidden. Apps consume explicit
service/package/contract boundaries. Use each service's project manifest and
source tree as the current implementation authority.
