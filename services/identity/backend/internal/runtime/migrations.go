package runtime

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
)

func RunMigrations(ctx context.Context, runtimeEnvironment, databaseURL, directory string) error {
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(runtimeEnvironment, "identity migration"); err != nil {
		return err
	}
	if err := validateDatabaseTransport(runtimeEnvironment, databaseURL); err != nil {
		return err
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("open identity migration database: %w", err)
	}
	defer func() { _ = db.Close() }()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping identity migration database: %w", err)
	}
	records, err := postgres.LoadMigrationRecords(directory)
	if err != nil {
		return err
	}
	if err := postgres.ApplyMigrations(ctx, db, directory, records); err != nil {
		return err
	}
	if err := postgres.Ready(ctx, db); err != nil {
		return fmt.Errorf("identity schema readiness after migration: %w", err)
	}
	if err := postgres.VerifyMigrationHistory(ctx, db, records); err != nil {
		return err
	}
	if err := postgres.VerifyExactConstraints(ctx, db); err != nil {
		return fmt.Errorf("identity exact schema proof: %w", err)
	}
	return nil
}

func VerifySchema(ctx context.Context, runtimeEnvironment, databaseURL, directory string) error {
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(runtimeEnvironment, "identity schema verification"); err != nil {
		return err
	}
	if err := validateDatabaseTransport(runtimeEnvironment, databaseURL); err != nil {
		return err
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("open identity schema verification database: %w", err)
	}
	defer func() { _ = db.Close() }()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping identity schema verification database: %w", err)
	}
	records, err := postgres.LoadMigrationRecords(directory)
	if err != nil {
		return err
	}
	if err := postgres.Ready(ctx, db); err != nil {
		return fmt.Errorf("identity schema readiness: %w", err)
	}
	if err := postgres.VerifyMigrationHistory(ctx, db, records); err != nil {
		return err
	}
	if err := postgres.VerifyExactConstraints(ctx, db); err != nil {
		return fmt.Errorf("identity exact schema proof: %w", err)
	}
	return nil
}
