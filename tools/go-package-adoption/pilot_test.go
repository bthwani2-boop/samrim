package engineadoption

import (
	"context"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	"go.opentelemetry.io/otel"
	"testing"
)

// Compile and contract check only. Never modifies runtime PostgreSQL drivers.
func TestPgxConfigWithoutNetwork(t *testing.T) {
	cfg, err := pgx.ParseConfig("postgres://user:pass@localhost:5432/bthwani?sslmode=disable")
	if err != nil || cfg.Host != "localhost" || cfg.Port != 5432 {
		t.Fatalf("unexpected pgx config: %+v, %v", cfg, err)
	}
}
func TestValidatorInput(t *testing.T) {
	v := validator.New()
	type Envelope struct {
		Reference string `validate:"required,min=3"`
	}
	if err := v.Struct(Envelope{Reference: "A"}); err == nil {
		t.Fatal("must reject invalid reference")
	}
	if err := v.Struct(Envelope{Reference: "REQ-123"}); err != nil {
		t.Fatalf("valid reference: %v", err)
	}
}
func TestOtelTracingAPI(t *testing.T) {
	ctx, span := otel.Tracer("bthwani-go-package-pilot").Start(context.Background(), "sample")
	defer span.End()
	if ctx == nil {
		t.Fatal("tracing context missing")
	}
}
func TestContainersRequestConfiguration(t *testing.T) {
	req := testcontainers.ContainerRequest{Image: "postgres:18", ExposedPorts: []string{"5432/tcp"}}
	if req.Image != "postgres:18" || len(req.ExposedPorts) != 1 {
		t.Fatal("test fixture failed")
	}
}
