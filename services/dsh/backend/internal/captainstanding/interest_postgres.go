package captainstanding

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

// PostgresInterestRepository owns candidate contact data, not standing or Identity.
type PostgresInterestRepository struct {
	db     *sql.DB
	schema string
}

func NewPostgresInterestRepository(db *sql.DB, schema string) (*PostgresInterestRepository, error) {
	if db == nil || len(schema) > 63 || !isolatedSchema.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresInterestRepository{db: db, schema: schema}, nil
}
func (r *PostgresInterestRepository) Insert(ctx context.Context, in InterestSubmission) error {
	if r == nil || r.db == nil {
		return ErrOwnerUnavailable
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, nil, "captain_interest")
	if err != nil {
		return ErrUnknownResult
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO captain_interest
    (name,phone,city,district,vehicle_type,plate_registered,phone_type,experienced,experience_details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (phone) DO NOTHING`,
		in.Name, in.Phone, in.City, in.District, in.VehicleType, in.PlateRegistered, in.PhoneType, in.Experienced, in.ExperienceDetails)
	if err != nil || tx.Commit() != nil {
		return ErrUnknownResult
	}
	return nil
}
func scanInterest(scanner interface{ Scan(...any) error }) (Interest, error) {
	var row Interest
	var plate sql.NullBool
	var created time.Time
	err := scanner.Scan(&row.ID, &row.Name, &row.Phone, &row.City, &row.District, &row.VehicleType,
		&plate, &row.PhoneType, &row.Experienced, &row.ExperienceDetails, &row.Contacted, &created)
	if err != nil {
		return Interest{}, err
	}
	if plate.Valid {
		row.PlateRegistered = &plate.Bool
	}
	row.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	return row, nil
}

func (r *PostgresInterestRepository) List(ctx context.Context, filter InterestFilter) (InterestPage, error) {
	if r == nil || r.db == nil || filter.Limit < 1 || filter.Limit > 50 || filter.BeforeID < 0 {
		return InterestPage{}, ErrInvalidChange
	}
	var contacted any
	if filter.Contacted != nil {
		contacted = *filter.Contacted
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{ReadOnly: true}, "captain_interest")
	if err != nil {
		return InterestPage{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,name,phone,city,district,vehicle_type,plate_registered,phone_type,
    experienced,experience_details,(contacted_at IS NOT NULL),created_at FROM captain_interest
    WHERE ($1::bigint=0 OR id < $1)
      AND ($2::text='' OR city=$2)
      AND ($3::text='' OR vehicle_type=$3)
      AND ($4::boolean IS NULL OR (contacted_at IS NOT NULL)=$4)
    ORDER BY id DESC LIMIT $5`,
		filter.BeforeID, filter.City, filter.VehicleType, contacted, filter.Limit+1)
	if err != nil {
		return InterestPage{}, ErrOwnerUnavailable
	}
	defer rows.Close()
	page := InterestPage{Items: []Interest{}}
	for rows.Next() {
		entry, err := scanInterest(rows)
		if err != nil {
			return InterestPage{}, ErrOwnerUnavailable
		}
		page.Items = append(page.Items, entry)
	}
	if rows.Err() != nil || rows.Close() != nil || tx.Commit() != nil {
		return InterestPage{}, ErrOwnerUnavailable
	}
	if len(page.Items) > filter.Limit {
		page.Items = page.Items[:filter.Limit]
		page.NextCursor = strconv.FormatInt(page.Items[len(page.Items)-1].ID, 10)
	}
	return page, nil
}
func (r *PostgresInterestRepository) MarkContacted(ctx context.Context, id int64, actorID string) (Interest, error) {
	if r == nil || r.db == nil || id < 1 || !validActorID(actorID) {
		return Interest{}, ErrInvalidChange
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, nil, "captain_interest")
	if err != nil {
		return Interest{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	row, err := scanInterest(tx.QueryRowContext(ctx, `UPDATE captain_interest
    SET contacted_at=COALESCE(contacted_at,clock_timestamp()),
        contacted_by_actor=COALESCE(contacted_by_actor,$2)
    WHERE id=$1 RETURNING id,name,phone,city,district,vehicle_type,plate_registered,phone_type,
    experienced,experience_details,(contacted_at IS NOT NULL),created_at`, id, actorID))
	if errors.Is(err, sql.ErrNoRows) {
		return Interest{}, ErrNotFound
	}
	if err != nil || tx.Commit() != nil {
		return Interest{}, ErrOwnerUnavailable
	}
	return row, nil
}
