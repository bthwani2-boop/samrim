FROM golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS build
WORKDIR /src
COPY services/wlt/backend/go.mod services/wlt/backend/go.sum ./services/wlt/backend/
WORKDIR /src/services/wlt/backend
RUN go mod download

WORKDIR /src
COPY services/wlt/backend ./services/wlt/backend
WORKDIR /src/services/wlt/backend
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/schema-verify ./cmd/schema-verify
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/financial-invariants ./cmd/financial-invariants

FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache ca-certificates && addgroup -S wlt && adduser -S -G wlt wlt
WORKDIR /app
COPY --from=build /out/api /api
COPY --from=build /out/migrate /migrate
COPY --from=build /out/schema-verify /schema-verify
COPY --from=build /out/financial-invariants /financial-invariants
COPY services/wlt/database/migrations /app/migrations
ENV WLT_MIGRATION_DIR=/app/migrations
USER wlt
EXPOSE 8083
ENTRYPOINT ["/api"]
