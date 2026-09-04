FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/identity/clients/go ./services/identity/clients/go
COPY services/workforce/backend ./services/workforce/backend
WORKDIR /src/services/workforce/backend
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM scratch
COPY --from=build /out/api /api
EXPOSE 8086
ENTRYPOINT ["/api"]
