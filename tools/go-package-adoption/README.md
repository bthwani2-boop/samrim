# Isolated Go package adoption

This standalone Go module is intentionally **not** included in the root `go.work` and changes no DSH, Identity or WLT runtime driver.

It pins and compiles `pgx/v5`, `validator/v10`, `go.opentelemetry.io/otel`, `testcontainers-go`, and the `sqlc` code generator. Unit smoke tests verify their API shape without touching platform databases, user data, or finance transactions.

A production driver migration needs live PostgreSQL proof of transactions, locks, retry/concurrency, and ledger parity. No Docker container is launched in this unit check.
