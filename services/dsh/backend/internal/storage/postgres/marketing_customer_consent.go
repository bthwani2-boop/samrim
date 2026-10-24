package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrMarketingConsentInvalid  = errors.New("marketing consent input is invalid")
	ErrMarketingConsentConflict = errors.New("marketing consent version or idempotency conflict")
)

type MarketingConsentChange struct {
	ClientActorID   string
	Channel         string
	Purpose         string
	Decision        string
	Source          string
	ExpectedVersion int
	IdempotencyKey  string
}

type MarketingConsentResult struct {
	Decision string `json:"decision"`
	Version  int    `json:"version"`
	Replay   bool   `json:"replay"`
}

// CanSendPromotionalContact is fail-closed when consent does not exist.
// It must not gate transactional order notifications.
func CanSendPromotionalContact(ctx context.Context, db *sql.DB, clientActorID, channel string) (bool, error) {
	clientActorID, channel = strings.TrimSpace(clientActorID), strings.ToUpper(strings.TrimSpace(channel))
	if db == nil || !validMarketingConsentIdentity(clientActorID, channel) {
		return false, ErrMarketingConsentInvalid
	}
	var permitted bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS(
    SELECT 1 FROM dsh.customer_marketing_consents
    WHERE client_actor_id=$1 AND channel=$2 AND purpose='PROMOTIONS' AND status='OPTED_IN')`,
		clientActorID, channel).Scan(&permitted)
	if err != nil {
		return false, err
	}
	return permitted, nil
}

func validMarketingConsentIdentity(actor, channel string) bool {
	if actor == "" || len(actor) > 128 {
		return false
	}
	switch channel {
	case "PUSH", "SMS", "EMAIL", "IN_APP":
		return true
	}
	return false
}

// ChangePromotionalContactConsent must be called only after authenticating
// the CLIENT actor and binding clientActorID to that verified session. An
// Opt-out is always allowed (even on stale versions), while an Opt-in requires
// current-version consent to avoid resurrection after a withdrawal.
func ChangePromotionalContactConsent(ctx context.Context, db *sql.DB, in MarketingConsentChange) (MarketingConsentResult, error) {
	in.ClientActorID = strings.TrimSpace(in.ClientActorID)
	in.Channel = strings.ToUpper(strings.TrimSpace(in.Channel))
	in.Purpose = strings.ToUpper(strings.TrimSpace(in.Purpose))
	in.Decision = strings.ToUpper(strings.TrimSpace(in.Decision))
	in.Source = strings.ToUpper(strings.TrimSpace(in.Source))
	in.IdempotencyKey = strings.TrimSpace(in.IdempotencyKey)
	if db == nil || !validMarketingConsentIdentity(in.ClientActorID, in.Channel) ||
		in.Purpose != "PROMOTIONS" || (in.Decision != "OPTED_IN" && in.Decision != "OPTED_OUT") ||
		(in.Source != "CUSTOMER_APP" && in.Source != "CUSTOMER_WEB") ||
		len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 128 || in.ExpectedVersion < 0 {
		return MarketingConsentResult{}, ErrMarketingConsentInvalid
	}
	digest := sha256.Sum256([]byte(strings.Join([]string{
		in.ClientActorID, in.Channel, in.Purpose, in.Decision, in.Source, fmt.Sprint(in.ExpectedVersion),
	}, "\x00")))
	hash := hex.EncodeToString(digest[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MarketingConsentResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
		"dsh:marketing-consent:"+in.ClientActorID+":"+in.Channel+":"+in.Purpose); err != nil {
		return MarketingConsentResult{}, err
	}
	var storedHash, storedDecision string
	var previousResultVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash,decision,result_version
  FROM dsh.customer_marketing_consent_events
  WHERE client_actor_id=$1 AND idempotency_key=$2`,
		in.ClientActorID, in.IdempotencyKey).Scan(&storedHash, &storedDecision, &previousResultVersion)
	if err == nil {
		if storedHash != hash {
			return MarketingConsentResult{}, ErrMarketingConsentConflict
		}
		if err = tx.Commit(); err != nil {
			return MarketingConsentResult{}, err
		}
		return MarketingConsentResult{Decision: storedDecision, Version: previousResultVersion, Replay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MarketingConsentResult{}, err
	}
	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT version FROM dsh.customer_marketing_consents
   WHERE client_actor_id=$1 AND channel=$2 AND purpose=$3 FOR UPDATE`,
		in.ClientActorID, in.Channel, in.Purpose).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return MarketingConsentResult{}, err
	}
	if in.Decision == "OPTED_IN" && in.ExpectedVersion != currentVersion {
		return MarketingConsentResult{}, ErrMarketingConsentConflict
	}
	resultVersion := currentVersion + 1
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.customer_marketing_consents(
    client_actor_id,channel,purpose,status,version)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(client_actor_id,channel,purpose)
    DO UPDATE SET status=EXCLUDED.status,version=EXCLUDED.version,updated_at=clock_timestamp()`,
		in.ClientActorID, in.Channel, in.Purpose, in.Decision, resultVersion); err != nil {
		return MarketingConsentResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.customer_marketing_consent_events(
    client_actor_id,channel,purpose,decision,expected_version,result_version,idempotency_key,request_hash,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		in.ClientActorID, in.Channel, in.Purpose, in.Decision, in.ExpectedVersion, resultVersion, in.IdempotencyKey, hash, in.Source); err != nil {
		return MarketingConsentResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return MarketingConsentResult{}, err
	}
	return MarketingConsentResult{Decision: in.Decision, Version: resultVersion}, nil
}
