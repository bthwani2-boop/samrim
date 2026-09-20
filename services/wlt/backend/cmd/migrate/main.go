package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func main() {
	environment, err := opsafety.RequireOrdinaryCLIEnvironment(os.Getenv("BTHWANI_ENV"), "wlt migration")
	if err != nil {
		log.Fatal(err)
	}
	databaseURL := strings.TrimSpace(os.Getenv("WLT_MIGRATION_DATABASE_URL"))
	if databaseURL == "" {
		if environment == "staging" || environment == "production" {
			log.Fatal("WLT_MIGRATION_DATABASE_URL is required outside local environments")
		}
		databaseURL = strings.TrimSpace(os.Getenv("WLT_DATABASE_URL"))
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		log.Fatal(err)
	}
	directory := strings.TrimSpace(os.Getenv("WLT_MIGRATION_DIR"))
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
	records, sqls, err := postgres.LoadMigrations(directory)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := postgres.Migrate(ctx, db, records, sqls); err != nil {
		log.Fatal(err)
	}
	if err := postgres.VerifySchema(ctx, db, records); err != nil {
		log.Fatal(err)
	}
	log.Printf("WLT_SCHEMA_EXACT=PASS schema v%d", postgres.SchemaVersion)
}
