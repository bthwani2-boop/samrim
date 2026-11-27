# syntax=docker/dockerfile:1
# Owner-local build; pinned Go builder and Alpine runtime inputs.
# WLT is a read-only development owner, never an automatic ledger migrator.
FROM golang:1.27.4-alpine@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS build
ENV GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=0
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download && go mod verify
COPY backend/cmd/ ./cmd/
COPY backend/internal/ ./internal/
RUN go build -trimpath -ldflags="-s -w" -o /out/wlt ./cmd/wlt

FROM alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
# Install the exact upstream security-fixed OpenSSL packages before dropping root.
RUN apk add --no-cache --upgrade libcrypto3=3.5.9-r2 libssl3=3.5.9-r2
ARG SAMRIM_SOURCE_REVISION=unverified
LABEL org.opencontainers.image.revision="${SAMRIM_SOURCE_REVISION}"
WORKDIR /app
COPY --from=build /out/wlt /usr/local/bin/wlt
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/wlt"]
