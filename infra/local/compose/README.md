# Local compose

Single canonical local runtime-composition authority for development infrastructure.

It provisions PostgreSQL/PostGIS, MinIO, and Mailpit only. Domain schemas and migrations remain owned by their services.

Copy `.env.example` to the ignored `.env` through `pnpm bootstrap`; never commit real local credentials.
