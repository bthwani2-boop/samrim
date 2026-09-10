package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func main() {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("BTHWANI_ENV")))
	if environment != "development" && environment != "test" && environment != "staging" && environment != "production" {
		log.Fatal("BTHWANI_ENV must be development, test, staging, or production")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DSH_SCHEMA_DATABASE_URL"))
	if databaseURL == "" {
		if environment == "staging" || environment == "production" {
			log.Fatal("DSH_SCHEMA_DATABASE_URL is required outside local environments")
		}
		databaseURL = strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	}
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(environment, "dsh schema verification"); err != nil {
		log.Fatal(err)
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		log.Fatal(err)
	}
	directory := strings.TrimSpace(os.Getenv("DSH_MIGRATION_DIR"))
	if directory == "" {
		directory = filepath.Clean("../database/migrations")
		if _, err := os.Stat(directory); err != nil {
			directory = "/app/migrations"
		}
	}
	db, err := postgres.Open(databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	record, _, err := postgres.LoadMigration(directory)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := postgres.VerifySchema(ctx, db, record); err != nil {
		log.Fatal(err)
	}
	log.Printf("DSH_SCHEMA_EXACT=PASS schema v%d", postgres.SchemaVersion)
}
