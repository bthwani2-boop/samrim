FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/identity/clients/go ./services/identity/clients/go
COPY services/dsh/backend ./services/dsh/backend
WORKDIR /src/services/dsh/backend
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/schema-verify ./cmd/schema-verify

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S dsh && adduser -S -G dsh dsh
WORKDIR /app
COPY --from=build /out/api /api
COPY --from=build /out/migrate /migrate
COPY --from=build /out/schema-verify /schema-verify
COPY services/dsh/backend/internal/storage/postgres/001_partner_bootstrap.sql /app/migrations/001_partner_bootstrap.sql
ENV DSH_MIGRATION_DIR=/app/migrations
USER dsh
EXPOSE 8080
ENTRYPOINT ["/api"]
