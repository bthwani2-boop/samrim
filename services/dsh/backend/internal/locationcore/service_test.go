package locationcore

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestRequireActiveServiceCityPreservesReadFailure(t *testing.T) {
	// Never connects: the context is canceled before any database read.
	db, err := sql.Open("postgres", "postgres://unused:unused@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = (&Service{db: db}).requireActiveServiceCity(ctx, "city-sanaa")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canonical city read error must remain retryable, got %v", err)
	}
	if errors.Is(err, postgres.ErrServiceCityNotFound) {
		t.Fatalf("database failure must not be reported as missing city: %v", err)
	}
}

func TestRequireActiveServiceCityRejectsMissingID(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://unused:unused@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	err = (&Service{db: db}).requireActiveServiceCity(context.Background(), "")
	if !errors.Is(err, postgres.ErrServiceCityNotFound) {
		t.Fatalf("missing city ID must be reported as missing city, got %v", err)
	}
}
