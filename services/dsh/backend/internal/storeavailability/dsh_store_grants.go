package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
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
	var ownerID string
	err := g.db.QueryRowContext(ctx, fmt.Sprintf(
		"SELECT owner_actor_id FROM %s.stores WHERE id=$1", g.schema), storeID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if ownerID != actorID {
		return ErrForbidden
	}
	return nil
}

// StoreTimezone is DSH's current canonical service-city timezone, not a
// Merchant-controlled body parameter or a stored fallback in the app.
func (g *PostgresStoreGrants) StoreTimezone(ctx context.Context, storeID string) (string, error) {
	if strings.TrimSpace(storeID) == "" {
		return "", ErrStoreMissing
	}
	var timezone sql.NullString
	query := fmt.Sprintf(`SELECT c.timezone_name
		FROM %s.stores AS s JOIN %s.service_cities AS c ON c.id=s.city_id
		WHERE s.id=$1`, g.schema, g.schema)
	err := g.db.QueryRowContext(ctx, query, storeID).Scan(&timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrStoreMissing
	}
	if err != nil {
		return "", err
	}
	if !timezone.Valid || strings.TrimSpace(timezone.String) == "" {
		return "", ErrInvalidTimezone
	}
	if _, err = time.LoadLocation(timezone.String); err != nil {
		return "", ErrInvalidTimezone
	}
	return timezone.String, nil
}
