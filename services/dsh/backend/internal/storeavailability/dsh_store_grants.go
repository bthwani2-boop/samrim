package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// PostgresStoreGrants reads the existing DSH Store and service-city authority.
// This first bounded stage permits a currently verified Store owner only:
// delegated grants have not been implemented and are deliberately denied.
type PostgresStoreGrants struct {
	db     *sql.DB
	schema string
}

func NewPostgresStoreGrants(db *sql.DB, schema string) (*PostgresStoreGrants, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresStoreGrants{db: db, schema: schema}, nil
}

func (g *PostgresStoreGrants) RequireStoreAction(ctx context.Context, actorID, storeID, action string) error {
	if strings.TrimSpace(actorID) == "" || strings.TrimSpace(storeID) == "" || action != "store_operations" {
		return ErrForbidden
	}
	tx, err := beginScopedStoreTx(ctx, g.db, g.schema, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ownerID string
	err = tx.QueryRowContext(ctx, "SELECT owner_actor_id FROM stores WHERE id=$1", storeID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if ownerID != actorID {
		return ErrForbidden
	}
	return tx.Commit()
}

// StoreTimezone is DSH's current canonical service-city timezone, not a
// Merchant-controlled body parameter or a stored fallback in the app.
func (g *PostgresStoreGrants) StoreTimezone(ctx context.Context, storeID string) (string, error) {
	if strings.TrimSpace(storeID) == "" {
		return "", ErrStoreMissing
	}
	tx, err := beginScopedStoreTx(ctx, g.db, g.schema, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	timezone, err := readStoreTimezone(ctx, tx, storeID)
	if err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return timezone, nil
}

// Read the canonical city zone in the caller's existing Store transaction.
func readStoreTimezone(ctx context.Context, tx *sql.Tx, storeID string) (string, error) {
	var timezone sql.NullString
	query := `SELECT c.timezone_name
		FROM stores AS s JOIN service_cities AS c ON c.id=s.city_id
		WHERE s.id=$1`
	err := tx.QueryRowContext(ctx, query, storeID).Scan(&timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrStoreMissing
	}
	if err != nil {
		return "", err
	}
	if !timezone.Valid || strings.TrimSpace(timezone.String) == "" {
		return "", ErrInvalidTimezone
	}
	if _, err = loadStoreTimezone(timezone.String); err != nil {
		return "", ErrInvalidTimezone
	}
	return timezone.String, nil
}
