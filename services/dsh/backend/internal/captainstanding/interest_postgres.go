package captainstanding

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/lib/pq"
)

// PostgresInterestRepository owns candidate contact data, not standing or Identity.
type PostgresInterestRepository struct {
	db    *sql.DB
	table string
}

func NewPostgresInterestRepository(db *sql.DB, schema string) (*PostgresInterestRepository, error) {
	if db == nil || len(schema) > 63 || !isolatedSchema.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresInterestRepository{db: db, table: pq.QuoteIdentifier(schema) + ".captain_interest"}, nil
}
func (r *PostgresInterestRepository) Insert(ctx context.Context, in InterestSubmission) error {
	if r == nil || r.db == nil {
		return ErrOwnerUnavailable
	}
	_, err := r.db.ExecContext(ctx, `INSERT INTO `+r.table+`
    (name,phone,city,district,vehicle_type,plate_registered,phone_type,experienced,experience_details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (phone) DO NOTHING`,
		in.Name, in.Phone, in.City, in.District, in.VehicleType, in.PlateRegistered, in.PhoneType, in.Experienced, in.ExperienceDetails)
	if err != nil {
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

const interestProjection = `id,name,phone,city,district,vehicle_type,plate_registered,phone_type,
  experienced,experience_details,(contacted_at IS NOT NULL),created_at`

func (r *PostgresInterestRepository) List(ctx context.Context, filter InterestFilter) (InterestPage, error) {
	if r == nil || r.db == nil || filter.Limit < 1 || filter.Limit > 50 || filter.BeforeID < 0 {
		return InterestPage{}, ErrInvalidChange
	}
	var contacted any
	if filter.Contacted != nil {
		contacted = *filter.Contacted
	}
	rows, err := r.db.QueryContext(ctx, `SELECT `+interestProjection+` FROM `+r.table+`
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
	if rows.Err() != nil {
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
	row, err := scanInterest(r.db.QueryRowContext(ctx, `UPDATE `+r.table+`
    SET contacted_at=COALESCE(contacted_at,clock_timestamp()),
        contacted_by_actor=COALESCE(contacted_by_actor,$2)
    WHERE id=$1 RETURNING `+interestProjection, id, actorID))
	if errors.Is(err, sql.ErrNoRows) {
		return Interest{}, ErrNotFound
	}
	if err != nil {
		return Interest{}, ErrOwnerUnavailable
	}
	return row, nil
}
