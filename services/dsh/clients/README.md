# DSH owner-bound clients

STATUS: IMPLEMENTATION_IN_PROGRESS

The private `@bthwani/dsh` workspace package exports read-only public Store and Offer projections for Customer Expo. The source contract is `services/dsh/contracts/openapi/dsh.openapi.yaml` and its four publicly documented GET operations. The strict TypeScript transport checks URL policy, response shape, server error code and abortable requests; it does not store or write any DSH business fact, and never treats discovery as checkout authorization.

Local isolated tests exercise the running Go DSH owner against PostgreSQL. Android, production, historical Store migration, checkout, full generated OpenAPI client parity and real operator authorization have **not** been established by package typecheck. Only supported scopes may be shown as operational.

Do not fork transport DTOs elsewhere, add another Store writer, copy the donor implementation wholesale, or introduce a client-side business policy interpreter. Generate contract-derived client code at the owner when source implementation is accepted.
