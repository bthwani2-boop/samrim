package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	serviceruntime "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/runtime"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

func main() {
	identityEndpoint, err := identityintegration.ResolveBaseURL(os.Getenv("DSH_IDENTITY_API_BASE_URL"), os.Getenv("BTHWANI_ENV"), os.Getenv("DSH_IDENTITY_API_ALLOWED_HOSTS"))
	if err != nil {
		log.Fatal(err)
	}
	identityClient, err := identityintegration.New(identityEndpoint, os.Getenv("IDENTITY_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	managedAccess, err := transporthttp.NewManagedAccess(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	database, err := postgres.Open(os.Getenv("DSH_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	records, err := loadMigrations()
	if err != nil {
		log.Fatal(err)
	}
	partnerBootstrap, err := transporthttp.NewPartnerBootstrap(identityClient, os.Getenv("CONTROL_PANEL_SERVICE_TOKEN"), database)
	if err != nil {
		log.Fatal(err)
	}
	register := func(mux *http.ServeMux) {
		managedAccess.Register(mux)
		partnerBootstrap.Register(mux)
	}
	readiness := func(ctx context.Context) error {
		if err := postgres.VerifySchema(ctx, database, records); err != nil {
			return err
		}
		return managedAccess.Ready(ctx)
	}
	if err := serviceruntime.RunWithRoutesAndReadiness("dsh", "/dsh", "18080", register, readiness); err != nil {
		log.Fatal(err)
	}
}

func loadMigrations() ([]postgres.MigrationRecord, error) {
	directory := strings.TrimSpace(os.Getenv("DSH_MIGRATION_DIR"))
	if directory == "" {
		directory = filepath.Clean("../database/migrations")
		if _, err := os.Stat(directory); err != nil {
			directory = "/app/migrations"
		}
	}
	records, _, err := postgres.LoadMigrations(directory)
	return records, err
}
