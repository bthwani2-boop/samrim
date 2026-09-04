FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/identity/backend/go.mod services/identity/backend/go.sum ./
RUN go mod download
COPY services/identity/backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S identity && adduser -S -G identity identity
WORKDIR /app
COPY --from=build /out/api /api
COPY services/identity/database/migrations/001_identity_activation_sessions.sql /app/migrations/001_identity_activation_sessions.sql
ENV IDENTITY_MIGRATION_FILE=/app/migrations/001_identity_activation_sessions.sql
USER identity
EXPOSE 8082
ENTRYPOINT ["/api"]
