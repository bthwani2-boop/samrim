package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	destinationKey := strings.TrimSpace(os.Getenv("WLT_DESTINATION_ENCRYPTION_KEY"))
	evidenceKey := strings.TrimSpace(os.Getenv("WLT_FINANCE_EVIDENCE_ENCRYPTION_KEY"))
	if destinationKey == "" && strings.EqualFold(strings.TrimSpace(os.Getenv("BTHWANI_ENV")), "development") {
		digest := sha256.Sum256([]byte("wlt-official-wallet-destination:" + os.Getenv("WLT_DSH_SERVICE_TOKEN")))
		destinationKey = hex.EncodeToString(digest[:])
	}
	if evidenceKey == "" && strings.EqualFold(strings.TrimSpace(os.Getenv("BTHWANI_ENV")), "development") {
		digest := sha256.Sum256([]byte("wlt-finance-evidence:" + os.Getenv("WLT_DSH_SERVICE_TOKEN")))
		evidenceKey = hex.EncodeToString(digest[:])
	}
	server, err := transporthttp.NewWithCashInConfig(database, os.Getenv("WLT_DSH_SERVICE_TOKEN"), destinationKey, evidenceKey, os.Getenv("WLT_CASH_IN_MODE"), os.Getenv("BTHWANI_ENV"))
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
