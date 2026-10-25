FROM golang:1.27.3-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS build
WORKDIR /src
COPY services/identity/backend/go.mod services/identity/backend/go.sum ./
RUN go mod download
COPY services/identity/backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/schema-verify ./cmd/schema-verify
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/bootstrap-operator ./cmd/bootstrap-operator

FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
ARG SAMRIM_SOURCE_REVISION=unverified
LABEL org.opencontainers.image.revision=$SAMRIM_SOURCE_REVISION
RUN apk add --no-cache ca-certificates && addgroup -S identity && adduser -S -G identity identity
WORKDIR /app
COPY --from=build /out/api /api
COPY --from=build /out/migrate /migrate
COPY --from=build /out/schema-verify /schema-verify
COPY --from=build /out/bootstrap-operator /bootstrap-operator
COPY services/identity/database/migrations /app/migrations
ENV IDENTITY_MIGRATION_DIR=/app/migrations
USER identity
EXPOSE 8082
ENTRYPOINT ["/api"]
