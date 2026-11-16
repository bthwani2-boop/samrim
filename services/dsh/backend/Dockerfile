# syntax=docker/dockerfile:1
# Service-owned, pinned, reproducible Linux build. Context: services/dsh/
FROM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS build
ENV GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=0
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download && go mod verify
COPY backend/cmd/ ./cmd/
COPY backend/internal/ ./internal/
RUN go build -trimpath -ldflags="-s -w" -o /out/dsh ./cmd/dsh

FROM alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f
ARG SAMRIM_SOURCE_REVISION=unverified
LABEL org.opencontainers.image.revision="${SAMRIM_SOURCE_REVISION}"
WORKDIR /app
COPY --from=build /out/dsh /usr/local/bin/dsh
COPY database/migrations/ /app/database/migrations/
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/dsh"]
