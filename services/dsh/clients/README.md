# DSH client boundaries

STATUS: SCAFFOLD_ONLY

The package `@bthwani/dsh` is available to the pnpm workspace but exports **no usable operations** at this stage. `index.ts` is deliberately an empty TypeScript module to exercise the existing typecheck toolchain, not a mock client.

After the owner's real OpenAPI contract is approved and tested:
- Put reviewed TypeScript transports and session/storage adapters in `clients/` only when they have actual consumers.
- Generate OpenAPI-derived types and operations into `clients/generated/`; never maintain generated types as an independent authority.
- Add a Go caller under `clients/go/` only for an evidenced cross-service consumer, with its Go module/build boundaries reviewed then.
- Update `index.ts` exports and package dependencies only after their source and consumers exist. Avoid inventing global session state, endpoint URLs, credentials or a second business writer.

Service ownership and future backend/contracts/database locations are documented in [the service README](../README.md). No running service, HTTP API or financial state is implied.
