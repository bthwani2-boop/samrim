# The NEW refoundation Identity Go verifier, not the archived Identity service.
# Build context: reviewed Linux binary compiled from services/identity/backend.
# Migrations are bundled for inspection but are NEVER executed by this image.
FROM alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f
WORKDIR /app
COPY identity /usr/local/bin/identity
COPY database/migrations/ database/migrations/
USER 65532:65532
EXPOSE 3302
ENTRYPOINT ["/usr/local/bin/identity"]
