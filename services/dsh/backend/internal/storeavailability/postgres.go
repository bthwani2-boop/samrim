package storeavailability

import (
	"database/sql"
	"errors"
	"regexp"

	"github.com/lib/pq"
)

// PostgresRepository writes operational facts in the SAME DSH Store schema.
// It never persists the derived orderability enum and never modifies WLT.
type PostgresRepository struct {
	db     *sql.DB
	schema string
}

var postgresSchemaRule = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

func NewPostgresRepository(db *sql.DB, schema string) (*PostgresRepository, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresRepository{db: db, schema: schema}, nil
}

func normalizePgError(err error) error {
	var pg *pq.Error
	if errors.As(err, &pg) && pg.Code == "40001" {
		return ErrVersionConflict
	}
	return err
}
