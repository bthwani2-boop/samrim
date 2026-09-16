package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestServiceCityLifecycleIntegrity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the Service City proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("apply service city migrations: %v", err)
		}
		for _, invalidName := range []string{"Sana'a", "صنعاء Sana'a"} {
			if _, err := postgres.CreateServiceCity(ctx, db, invalidName, true, "idem-city-invalid-"+invalidName, postgres.HashServiceCityCreateRequest(invalidName, true), "act_operator_city_v1", "corr-city-invalid-v1"); !errors.Is(err, postgres.ErrServiceCityInvalid) {
				t.Fatalf("expected non-Arabic service city name rejection for %q, got %v", invalidName, err)
			}
		}
		created, err := postgres.CreateServiceCity(ctx, db, "صنعاء", true, "idem-city-create-v1", postgres.HashServiceCityCreateRequest("صنعاء", true), "act_operator_city_v1", "corr-city-create-v1")
		if err != nil || created.Replayed || created.City.Version != 1 || !created.City.Active || !strings.HasPrefix(created.City.ID, "city_") {
			t.Fatalf("create service city failed: %+v err=%v", created, err)
		}
		replay, err := postgres.CreateServiceCity(ctx, db, "صنعاء", true, "idem-city-create-v1", postgres.HashServiceCityCreateRequest("صنعاء", true), "act_operator_city_v1", "corr-city-replay-v1")
		if err != nil || !replay.Replayed || replay.City.ID != created.City.ID || replay.City.Version != 1 {
			t.Fatalf("service city replay failed: %+v err=%v", replay, err)
		}
		if _, err := postgres.CreateServiceCity(ctx, db, " صنعاء ", true, "idem-city-duplicate-name-v1", postgres.HashServiceCityCreateRequest(" صنعاء ", true), "act_operator_city_v1", "corr-city-duplicate-name-v1"); !errors.Is(err, postgres.ErrServiceCityExists) {
			t.Fatalf("expected normalized duplicate city name rejection, got %v", err)
		}
		updated, err := postgres.UpdateServiceCity(ctx, db, created.City.ID, "صنعاء", false, 1, "idem-city-deactivate-v1", postgres.HashServiceCityUpdateRequest(created.City.ID, "صنعاء", false, 1), "act_operator_city_v1", "corr-city-deactivate-v1")
		if err != nil || updated.Replayed || updated.City.Version != 2 || updated.City.Active {
			t.Fatalf("deactivate service city failed: %+v err=%v", updated, err)
		}
		updatedReplay, err := postgres.UpdateServiceCity(ctx, db, created.City.ID, "صنعاء", false, 1, "idem-city-deactivate-v1", postgres.HashServiceCityUpdateRequest(created.City.ID, "صنعاء", false, 1), "act_operator_city_v1", "corr-city-deactivate-replay-v1")
		if err != nil || !updatedReplay.Replayed || updatedReplay.City.Version != 2 || updatedReplay.City.Active {
			t.Fatalf("deactivate replay failed: %+v err=%v", updatedReplay, err)
		}
		if _, err := postgres.UpdateServiceCity(ctx, db, created.City.ID, "صنعاء", true, 1, "idem-city-stale-v1", postgres.HashServiceCityUpdateRequest(created.City.ID, "صنعاء", true, 1), "act_operator_city_v1", "corr-city-stale-v1"); !errors.Is(err, postgres.ErrServiceCityVersion) {
			t.Fatalf("expected stale service city version rejection, got %v", err)
		}
		reactivated, err := postgres.UpdateServiceCity(ctx, db, created.City.ID, "صنعاء", true, 2, "idem-city-reactivate-v1", postgres.HashServiceCityUpdateRequest(created.City.ID, "صنعاء", true, 2), "act_operator_city_v1", "corr-city-reactivate-v1")
		if err != nil || reactivated.City.Version != 3 || !reactivated.City.Active {
			t.Fatalf("reactivate service city failed: %+v err=%v", reactivated, err)
		}
		active, err := postgres.ListActiveServiceCities(ctx, db)
		if err != nil || len(active) != 1 || active[0].ID != created.City.ID || active[0].Version != 3 {
			t.Fatalf("active service city readback failed: %+v err=%v", active, err)
		}
		var auditCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.service_city_audit WHERE city_id=$1", created.City.ID).Scan(&auditCount); err != nil || auditCount != 3 {
			t.Fatalf("service city audit count mismatch: count=%d err=%v", auditCount, err)
		}
	})
}
