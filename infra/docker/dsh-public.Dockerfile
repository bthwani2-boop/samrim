# Built from the exact pinned Go source by infra/build-dsh-image.ps1.
# The build context contains only that generated Linux binary.
FROM alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f
WORKDIR /app
COPY dsh /usr/local/bin/dsh
COPY database/migrations/ database/migrations/
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/dsh"]
