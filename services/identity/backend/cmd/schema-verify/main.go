package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/opsafety"
	serviceruntime "github.com/bthwani2-boop/samrim/services/identity/backend/internal/runtime"
)

func main() {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("BTHWANI_ENV")))
	if environment != "development" && environment != "test" && environment != "staging" && environment != "production" {
		log.Fatal("BTHWANI_ENV must be development, test, staging, or production")
	}
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_SCHEMA_DATABASE_URL"))
	if databaseURL == "" {
		if environment == "staging" || environment == "production" {
			log.Fatal("IDENTITY_SCHEMA_DATABASE_URL is required outside local environments")
		}
		databaseURL = strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	}
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(environment, "identity schema verification"); err != nil {
		log.Fatal(err)
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		log.Fatal(err)
	}
	directory := strings.TrimSpace(os.Getenv("IDENTITY_MIGRATION_DIR"))
	if directory == "" {
		directory = filepath.Clean("../database/migrations")
		if _, err := os.Stat(directory); err != nil {
			directory = "/app/migrations"
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := serviceruntime.VerifySchema(ctx, environment, databaseURL, directory); err != nil {
		log.Fatal(err)
	}
	log.Printf("identity exact schema proof: PASS")
}
