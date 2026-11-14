package storeavailability

import (
	"context"
	"database/sql"
	"time"
)

// PostgresPolicySource reads DSH's current city-scoped Store-availability
// limits. The table has no default: until an authorized Operator Policies
// writer provisions a reviewed policy, availability mutations fail closed.
// This adapter does not grant permission to change that policy.
type PostgresPolicySource struct {
	db     *sql.DB
	schema string
}

func NewPostgresPolicySource(db *sql.DB, schema string) (*PostgresPolicySource, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresPolicySource{db: db, schema: schema}, nil
}

func (source *PostgresPolicySource) CurrentLimits(ctx context.Context, storeID string) (Limits, error) {
	if storeID == "" {
		return Limits{}, ErrPolicyUnavailable
	}
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema,
		&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return Limits{}, ErrPolicyUnavailable
	}
	defer tx.Rollback()

	var seconds, preparation int
	var version int64
	err = tx.QueryRowContext(ctx, `SELECT p.max_pause_seconds, p.max_preparation_minutes, p.version
        FROM stores s
        JOIN service_cities city ON city.id = s.city_id
        JOIN store_operational_limits p ON p.city_id = city.id
        WHERE s.id=$1 AND city.active`, storeID).Scan(&seconds, &preparation, &version)
	if err != nil {
		return Limits{}, ErrPolicyUnavailable
	}
	if version < 1 || seconds < 0 || seconds > 31536000 || preparation < 0 || preparation > 1440 {
		return Limits{}, ErrPolicyUnavailable
	}
	if err = tx.Commit(); err != nil {
		return Limits{}, ErrPolicyUnavailable
	}
	return Limits{MaxPause: time.Duration(seconds) * time.Second,
		MaxPreparationMinutes: preparation, Version: version}, nil
}
