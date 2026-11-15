package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"
)

var cityPolicyIDRule = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

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

// CityPolicy is DSH's current, versioned Store operational policy readback.
// It is not a writable policy model or an effective Store/checkout grant.
type CityPolicy struct {
	CityID                string    `json:"cityId"`
	Version               int64     `json:"version"`
	MaxPauseSeconds       int       `json:"maxPauseSeconds"`
	MaxPreparationMinutes int       `json:"maxPreparationMinutes"`
	ChangedByActor        string    `json:"changedByActor"`
	ChangeReason          string    `json:"changeReason"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type CityPolicyReader interface {
	ReadCityPolicy(context.Context, string) (CityPolicy, error)
}

// ReadCityPolicy reads only an active city with an explicitly provisioned DSH
// policy. No migration defaults and no direct Operator writes are introduced.
func (source *PostgresPolicySource) ReadCityPolicy(ctx context.Context, cityID string) (CityPolicy, error) {
	if source == nil || source.db == nil {
		return CityPolicy{}, ErrPolicyUnavailable
	}
	if !cityPolicyIDRule.MatchString(cityID) {
		return CityPolicy{}, ErrInvalidChange
	}
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema,
		&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return CityPolicy{}, ErrPolicyUnavailable
	}
	defer tx.Rollback()
	var current CityPolicy
	err = tx.QueryRowContext(ctx, `SELECT p.city_id, p.version, p.max_pause_seconds,
		p.max_preparation_minutes, p.changed_by_actor, p.change_reason, p.updated_at
		FROM service_cities AS city
		JOIN store_operational_limits AS p ON p.city_id=city.id
		WHERE city.id=$1 AND city.active`, cityID).
		Scan(&current.CityID, &current.Version, &current.MaxPauseSeconds,
			&current.MaxPreparationMinutes, &current.ChangedByActor,
			&current.ChangeReason, &current.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CityPolicy{}, ErrPolicyUnavailable
	}
	if err != nil {
		return CityPolicy{}, ErrPolicyUnavailable
	}
	if current.CityID != cityID || current.Version < 1 ||
		current.MaxPauseSeconds < 0 || current.MaxPauseSeconds > 31536000 ||
		current.MaxPreparationMinutes < 0 || current.MaxPreparationMinutes > 1440 ||
		strings.TrimSpace(current.ChangedByActor) == "" ||
		strings.TrimSpace(current.ChangeReason) == "" || current.UpdatedAt.IsZero() {
		return CityPolicy{}, ErrPolicyUnavailable
	}
	if err = tx.Commit(); err != nil {
		return CityPolicy{}, ErrPolicyUnavailable
	}
	return current, nil
}
