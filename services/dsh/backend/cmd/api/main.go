package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/managedaccess"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/partnerbootstrap"
	serviceruntime "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/runtime"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func main() {
	identityBaseURL, err := identityboundary.ResolveBaseURL(os.Getenv("DSH_IDENTITY_API_BASE_URL"), os.Getenv("BTHWANI_ENV"))
	if err != nil {
		log.Fatal(err)
	}
	identityClient, err := identityboundary.New(identityBaseURL, os.Getenv("IDENTITY_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	managedAccess, err := managedaccess.New(identityClient, os.Getenv("DSH_PLATFORM_CONTROL_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	database, err := postgres.Open(os.Getenv("DSH_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	record, _, err := loadMigration()
	if err != nil {
		log.Fatal(err)
	}
	partnerBootstrap, err := partnerbootstrap.New(identityClient, os.Getenv("DSH_PLATFORM_CONTROL_SERVICE_TOKEN"), database)
	if err != nil {
		log.Fatal(err)
	}
	register := func(mux *http.ServeMux) {
		managedAccess.Register(mux)
		partnerBootstrap.Register(mux)
	}
	readiness := func(ctx context.Context) error {
		if err := postgres.VerifySchema(ctx, database, record); err != nil {
			return err
		}
		return managedAccess.Ready(ctx)
	}
	if err := serviceruntime.RunWithRoutesAndReadiness("dsh", "/dsh", "18080", register, readiness); err != nil {
		log.Fatal(err)
	}
}

func loadMigration() (postgres.MigrationRecord, string, error) {
	directory := strings.TrimSpace(os.Getenv("DSH_MIGRATION_DIR"))
	if directory == "" {
		directory = filepath.Clean("../database/migrations")
		if _, err := os.Stat(directory); err != nil {
			directory = "/app/migrations"
		}
	}
	return postgres.LoadMigration(directory)
}
