# DSH owner-bound clients

STATUS: IMPLEMENTATION_IN_PROGRESS

The private `@bthwani/dsh` workspace package exports read-only public Store/Offer projections and opt-in private Store operational GET/PATCH clients. Their sole source contract is `services/dsh/contracts/openapi/dsh.openapi.yaml`, including `paths/store-access.yaml`. The private client requires a current Identity bearer per invocation; it never stores credentials, grants Store rights, writes business facts itself, or treats discovery as checkout authorization. Server-side DSH remains the only Store writer. TypeScript validation and an exported client are not evidence of active Merchant/Operator Web/Android UX.

Local isolated tests exercise the running Go DSH owner against PostgreSQL. Android, production, historical Store migration, checkout, full generated OpenAPI client parity and real operator authorization have **not** been established by package typecheck. Only supported scopes may be shown as operational.

Do not fork transport DTOs elsewhere, add another Store writer, copy the donor implementation wholesale, or introduce a client-side business policy interpreter. Generate contract-derived client code at the owner when source implementation is accepted.
