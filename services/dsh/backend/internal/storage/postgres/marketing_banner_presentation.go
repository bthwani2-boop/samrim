package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var ErrBannerPresentationInvalid = errors.New("invalid marketing banner presentation")
var ErrBannerPresentationConflict = errors.New("marketing banner presentation version or idempotency conflict")

type BannerPresentation struct {
	Placement        string `json:"placement"`
	Mode             string `json:"mode"`
	IntervalSeconds  int    `json:"intervalSeconds"`
	Version          int    `json:"version"`
	UpdatedByActorID string `json:"updatedByActorId"`
}

func ReadBannerPresentation(ctx context.Context, db *sql.DB) (BannerPresentation, error) {
	var value BannerPresentation
	err := db.QueryRowContext(ctx, "SELECT placement, mode, interval_seconds, version, updated_by_actor_id FROM dsh.marketing_banner_presentation WHERE placement='HOME'").Scan(&value.Placement, &value.Mode, &value.IntervalSeconds, &value.Version, &value.UpdatedByActorID)
	return value, err
}

// SetBannerPresentation serializes marketing changes and records attributed, replay-safe audit events.
func SetBannerPresentation(ctx context.Context, db *sql.DB, mode string, seconds int, expected int, actor, correlation, idempotency string) (BannerPresentation, bool, error) {
	if (mode != "STATIC" && mode != "CINEMATIC" && mode != "CROSSFADE") || seconds < 3 || seconds > 10 || expected < 1 || actor == "" || correlation == "" || idempotency == "" {
		return BannerPresentation{}, false, ErrBannerPresentationInvalid
	}
	hash := HashMarketingFacts("banner-presentation:v1", mode, fmt.Sprint(seconds), fmt.Sprint(expected), actor)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return BannerPresentation{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var current BannerPresentation
	err = tx.QueryRowContext(ctx, "SELECT placement,mode,interval_seconds,version,updated_by_actor_id FROM dsh.marketing_banner_presentation WHERE placement='HOME' FOR UPDATE").Scan(&current.Placement, &current.Mode, &current.IntervalSeconds, &current.Version, &current.UpdatedByActorID)
	if err != nil {
		return BannerPresentation{}, false, err
	}
	var previousHash, replayMode string
	var replaySeconds, replayVersion int
	err = tx.QueryRowContext(ctx, "SELECT request_hash,result_mode,result_interval_seconds,result_version FROM dsh.marketing_banner_presentation_events WHERE idempotency_key=$1", idempotency).Scan(&previousHash, &replayMode, &replaySeconds, &replayVersion)
	if err == nil {
		if previousHash != hash {
			return BannerPresentation{}, false, ErrBannerPresentationConflict
		}
		if err := tx.Commit(); err != nil {
			return BannerPresentation{}, false, err
		}
		return BannerPresentation{Placement: "HOME", Mode: replayMode, IntervalSeconds: replaySeconds, Version: replayVersion, UpdatedByActorID: actor}, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return BannerPresentation{}, false, err
	}
	if current.Version != expected {
		return BannerPresentation{}, false, ErrBannerPresentationConflict
	}
	result := BannerPresentation{Placement: "HOME", Mode: mode, IntervalSeconds: seconds, Version: current.Version + 1, UpdatedByActorID: actor}
	_, err = tx.ExecContext(ctx, "UPDATE dsh.marketing_banner_presentation SET mode=$1, interval_seconds=$2,version=$3,updated_by_actor_id=$4,updated_at=clock_timestamp() WHERE placement='HOME'", mode, seconds, result.Version, actor)
	if err != nil {
		return BannerPresentation{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.marketing_banner_presentation_events
        (idempotency_key,request_hash,placement,expected_version,result_version,previous_mode,previous_interval_seconds,result_mode,result_interval_seconds,acting_actor_id,correlation_id)
        VALUES($1,$2,'HOME',$3,$4,$5,$6,$7,$8,$9,$10)`, idempotency, hash, expected, result.Version, current.Mode, current.IntervalSeconds, mode, seconds, actor, correlation)
	if err != nil {
		return BannerPresentation{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return BannerPresentation{}, false, err
	}
	return result, false, nil
}
