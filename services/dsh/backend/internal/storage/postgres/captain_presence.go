package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var ErrCaptainPresenceNotEligible = errors.New("captain is not on an eligible shift")

// Only the latest foreground GPS fix for an available Captain is persisted
// for dispatch ranking; no delivery route or position history is recorded.
func UpdateCaptainPresence(ctx context.Context, db *sql.DB, actorID string, lat, lng float64) (time.Time, error) {
	if db == nil || strings.TrimSpace(actorID) == "" {
		return time.Time{}, ErrCaptainPresenceNotEligible
	}
	lat, lng, err := normalizeLocation(lat, lng)
	if err != nil {
		return time.Time{}, err
	}
	var updated time.Time
	err = db.QueryRowContext(ctx, `INSERT INTO dsh.captain_presence_latest(captain_actor_id,latitude,longitude)
		SELECT a.actor_id,$2,$3 FROM dsh.captain_admissions a
		WHERE a.actor_id=$1 AND a.state='eligible' AND a.requires_profile_review=false
			AND a.availability_state='available'
		ON CONFLICT (captain_actor_id) DO UPDATE
			SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,updated_at=clock_timestamp()
		RETURNING updated_at`, strings.TrimSpace(actorID), lat, lng).Scan(&updated)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrCaptainPresenceNotEligible
	}
	return updated, err
}
