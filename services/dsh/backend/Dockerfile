FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/identity/clients/go ./services/identity/clients/go
COPY services/dsh/backend ./services/dsh/backend
WORKDIR /src/services/dsh/backend
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S dsh && adduser -S -G dsh dsh
COPY --from=build /out/api /api
USER dsh
EXPOSE 8080
ENTRYPOINT ["/api"]
