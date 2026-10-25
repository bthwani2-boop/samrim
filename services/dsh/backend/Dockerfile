FROM golang:1.27.3-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS build
WORKDIR /src
COPY services/dsh/backend/go.mod services/dsh/backend/go.sum ./services/dsh/backend/
COPY services/identity/clients/go/go.mod ./services/identity/clients/go/go.mod
WORKDIR /src/services/dsh/backend
RUN go mod download

WORKDIR /src
COPY services/identity/clients/go ./services/identity/clients/go
COPY services/dsh/backend ./services/dsh/backend
WORKDIR /src/services/dsh/backend
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/schema-verify ./cmd/schema-verify

FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
ARG SAMRIM_SOURCE_REVISION=unverified
LABEL org.opencontainers.image.revision=$SAMRIM_SOURCE_REVISION
RUN apk add --no-cache ca-certificates tzdata ffmpeg && addgroup -S dsh && adduser -S -G dsh dsh
WORKDIR /app
COPY --from=build /out/api /api
COPY --from=build /out/migrate /migrate
COPY --from=build /out/schema-verify /schema-verify
USER dsh
EXPOSE 8080
ENTRYPOINT ["/api"]
