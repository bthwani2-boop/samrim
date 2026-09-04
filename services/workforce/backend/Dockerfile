FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY services/workforce/backend/go.mod ./
RUN go mod download
COPY services/workforce/backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM scratch
COPY --from=build /out/api /api
EXPOSE 8086
ENTRYPOINT ["/api"]
