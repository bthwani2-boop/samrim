package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"

	serviceruntime "github.com/bthwani2-boop/samrim/services/wlt/backend/internal/runtime"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/wlt/backend/internal/transport/http"
)

func main() {
	database, err := postgres.Open(os.Getenv("WLT_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	records, _, err := loadMigrations()
	if err != nil {
		log.Fatal(err)
	}
	server, err := transporthttp.New(database, os.Getenv("WLT_DSH_SERVICE_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	if err := serviceruntime.RunWithRoutesAndReadiness("wlt", "/wlt", "18083", server.Register, func(ctx context.Context) error {
		return postgres.VerifySchema(ctx, database, records)
	}); err != nil {
		log.Fatal(err)
	}
}

func loadMigrations() ([]postgres.MigrationRecord, []string, error) {
	directory := strings.TrimSpace(os.Getenv("WLT_MIGRATION_DIR"))
	if directory == "" {
		directory = filepath.Clean("../database/migrations")
		if _, err := os.Stat(directory); err != nil {
			directory = "/app/migrations"
		}
	}
	return postgres.LoadMigrations(directory)
}
