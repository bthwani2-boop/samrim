FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/identity/backend/go.mod services/identity/backend/go.sum ./
RUN go mod download
COPY services/identity/backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/schema-verify ./cmd/schema-verify

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S identity && adduser -S -G identity identity
WORKDIR /app
COPY --from=build /out/api /api
COPY --from=build /out/migrate /migrate
COPY --from=build /out/schema-verify /schema-verify
COPY services/identity/database/migrations /app/migrations
ENV IDENTITY_MIGRATION_DIR=/app/migrations
USER identity
EXPOSE 8082
ENTRYPOINT ["/api"]
