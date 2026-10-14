package postgres

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"time"
)

var ErrCaptainPresenceNotEligible = errors.New("captain is not on an eligible shift")

// UpdateCaptainPresence holds only the current position. No route or position audit is stored.
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
          AND (a.availability_state='available'
            OR EXISTS (SELECT 1 FROM dsh.captain_assignments ca
              WHERE ca.captain_actor_id=a.actor_id AND ca.state='in_custody'))
        ON CONFLICT (captain_actor_id) DO UPDATE
          SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,updated_at=clock_timestamp()
        RETURNING updated_at`, strings.TrimSpace(actorID), lat, lng).Scan(&updated)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrCaptainPresenceNotEligible
	}
	return updated, err
}

// A heatmap cell is an anonymous aggregation of at least three recent eligible captains.
type CaptainPresenceCell struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Count     int     `json:"count"`
}

func captainPresenceCellSize(mode string) (float64, bool) {
	switch mode {
	case "wide":
		return 0.10, true
	case "balanced":
		return 0.05, true
	case "detailed":
		return 0.025, true
	default:
		return 0, false
	}
}
func ReadCaptainPresenceHeatmap(ctx context.Context, db *sql.DB, mode string) ([]CaptainPresenceCell, error) {
	size, ok := captainPresenceCellSize(mode)
	if db == nil || !ok {
		return nil, errors.New("invalid captain heatmap request")
	}
	rows, err := db.QueryContext(ctx, `SELECT floor(p.latitude/$1)::integer, floor(p.longitude/$1)::integer, count(*)::integer
        FROM dsh.captain_presence_latest p
        JOIN dsh.captain_admissions a ON a.actor_id=p.captain_actor_id
        WHERE p.updated_at>clock_timestamp()-interval '15 minutes'
          AND a.state='eligible' AND a.requires_profile_review=false
          AND (a.availability_state='available'
            OR EXISTS (SELECT 1 FROM dsh.captain_assignments ca
              WHERE ca.captain_actor_id=a.actor_id AND ca.state='in_custody'))
        GROUP BY 1,2 HAVING count(*)>=3
        ORDER BY count(*) DESC,1,2 LIMIT 100`, size)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cells := make([]CaptainPresenceCell, 0)
	for rows.Next() {
		var y, x, count int
		if err := rows.Scan(&y, &x, &count); err != nil {
			return nil, err
		}
		cells = append(cells, CaptainPresenceCell{
			Latitude:  math.Round((float64(y)+0.5)*size*100000) / 100000,
			Longitude: math.Round((float64(x)+0.5)*size*100000) / 100000,
			Count:     count,
		})
	}
	return cells, rows.Err()
}
