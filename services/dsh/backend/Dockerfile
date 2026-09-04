FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/identity/clients/go ./services/identity/clients/go
COPY services/dsh/backend ./services/dsh/backend
WORKDIR /src/services/dsh/backend
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM scratch
COPY --from=build /out/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
