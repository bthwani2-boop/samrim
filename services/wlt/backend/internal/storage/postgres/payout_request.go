package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

var (
	ErrPayoutInvalidInput   = errors.New("payout intent input is invalid")
	ErrPayoutNoFunds        = errors.New("eligible payout funds are unavailable")
	ErrPayoutDestination    = errors.New("verified active payout destination is required")
	ErrPayoutAmountExceeded = errors.New("requested payout exceeds eligible funds")
)

type PayoutIntentInput struct {
	ActorType      string
	ActorID        string
	AmountMode     string
	AmountMinor    *int64
	IdempotencyKey string
	CorrelationID  string
}

type PayoutRequestRecord struct {
	ID                   string
	ActorType            string
	ActorID              string
	AmountMode           string
	RequestedAmountMinor *int64
	ResolvedAmountMinor  int64
	Currency             string
	DestinationID        string
	DestinationVersion   int
	Status               string
	PolicyVersion        string
	CreatedAt            time.Time
}

type PayoutStateRecord struct {
	ActorType              string
	ActorID                string
	Currency               string
	EligibleAvailableMinor int64
	HeldMinor              int64
	Destination            *OfficialWalletDestinationRecord
	LatestPayout           *PayoutRequestRecord
}

func HashPayoutIntent(input PayoutIntentInput) string {
	amount := ""
	if input.AmountMinor != nil {
		amount = formatInt64(*input.AmountMinor)
	}
	return hashFacts("payout-intent", strings.TrimSpace(input.ActorType), strings.TrimSpace(input.ActorID), strings.TrimSpace(input.AmountMode), amount)
}

func CreatePayoutIntent(ctx context.Context, db *sql.DB, input PayoutIntentInput) (PayoutRequestRecord, bool, error) {
	input.ActorType = strings.ToLower(strings.TrimSpace(input.ActorType))
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.AmountMode = strings.ToUpper(strings.TrimSpace(input.AmountMode))
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || !validDestinationActor(input.ActorType) || boundedText(input.ActorID, 1, 128) == "" || (input.AmountMode != "FULL_AVAILABLE" && input.AmountMode != "SPECIFIED") || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PayoutRequestRecord{}, false, ErrPayoutInvalidInput
	}
	if input.AmountMode == "SPECIFIED" && (input.AmountMinor == nil || *input.AmountMinor <= 0) {
		return PayoutRequestRecord{}, false, ErrPayoutInvalidInput
	}
	if input.AmountMode == "FULL_AVAILABLE" && input.AmountMinor != nil {
		return PayoutRequestRecord{}, false, ErrPayoutInvalidInput
	}
	requestHash := HashPayoutIntent(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PayoutRequestRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:payout:"+input.ActorType+":"+input.ActorID); err != nil {
		return PayoutRequestRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.payout_requests WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return PayoutRequestRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readPayoutRequest(ctx, tx, existingID)
		if readErr != nil {
			return PayoutRequestRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PayoutRequestRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, false, err
	}
	var destinationID string
	var destinationVersion int
	if err := tx.QueryRowContext(ctx, "SELECT id,version FROM wlt.official_wallet_destinations WHERE actor_type=$1 AND actor_id=$2 AND verification_status='VERIFIED' AND status='ACTIVE_FOR_PAYOUT' FOR SHARE", input.ActorType, input.ActorID).Scan(&destinationID, &destinationVersion); errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, false, ErrPayoutDestination
	} else if err != nil {
		return PayoutRequestRecord{}, false, err
	}
	accountCode := walletAccountCode(input.ActorType)
	var grossAvailable, held int64
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code=$1 AND actor_id=$2", accountCode, input.ActorID).Scan(&grossAvailable); err != nil {
		return PayoutRequestRecord{}, false, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_minor),0) FROM wlt.payout_holds WHERE actor_type=$1 AND actor_id=$2 AND status='ACTIVE'", input.ActorType, input.ActorID).Scan(&held); err != nil {
		return PayoutRequestRecord{}, false, err
	}
	eligible := grossAvailable - held
	if eligible <= 0 {
		return PayoutRequestRecord{}, false, ErrPayoutNoFunds
	}
	resolved := eligible
	var requested *int64
	if input.AmountMode == "SPECIFIED" {
		requested = input.AmountMinor
		if *input.AmountMinor > eligible {
			return PayoutRequestRecord{}, false, ErrPayoutAmountExceeded
		}
		resolved = *input.AmountMinor
	}
	payoutID, err := newID("payout")
	if err != nil {
		return PayoutRequestRecord{}, false, err
	}
	holdID, err := newID("hold")
	if err != nil {
		return PayoutRequestRecord{}, false, err
	}
	policyVersion := "payout-eligibility-v1;destination-version=" + formatInt(destinationVersion)
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_requests(id,actor_type,actor_id,amount_mode,requested_amount_minor,resolved_amount_minor,destination_id,destination_version,status,policy_version,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'HELD',$9,$10,$11)`, payoutID, input.ActorType, input.ActorID, input.AmountMode, requested, resolved, destinationID, destinationVersion, policyVersion, input.IdempotencyKey, requestHash); err != nil {
		return PayoutRequestRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_holds(id,payout_id,actor_type,actor_id,amount_minor) VALUES($1,$2,$3,$4,$5)`, holdID, payoutID, input.ActorType, input.ActorID, resolved); err != nil {
		return PayoutRequestRecord{}, false, err
	}
	item, err := readPayoutRequest(ctx, tx, payoutID)
	if err != nil {
		return PayoutRequestRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PayoutRequestRecord{}, false, err
	}
	return item, false, nil
}

func ReadPayoutState(ctx context.Context, db *sql.DB, actorType, actorID string) (PayoutStateRecord, error) {
	actorType = strings.ToLower(strings.TrimSpace(actorType))
	actorID = strings.TrimSpace(actorID)
	if db == nil || !validDestinationActor(actorType) || boundedText(actorID, 1, 128) == "" {
		return PayoutStateRecord{}, ErrPayoutInvalidInput
	}
	result := PayoutStateRecord{ActorType: actorType, ActorID: actorID, Currency: "YER"}
	accountCode := walletAccountCode(actorType)
	var gross, held int64
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code=$1 AND actor_id=$2", accountCode, actorID).Scan(&gross); err != nil {
		return PayoutStateRecord{}, err
	}
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_minor),0) FROM wlt.payout_holds WHERE actor_type=$1 AND actor_id=$2 AND status='ACTIVE'", actorType, actorID).Scan(&held); err != nil {
		return PayoutStateRecord{}, err
	}
	result.HeldMinor = held
	result.EligibleAvailableMinor = gross - held
	if destination, err := ReadOfficialWalletDestination(ctx, db, actorType, actorID); err == nil {
		result.Destination = &destination
	} else if !errors.Is(err, ErrDestinationNotFound) {
		return PayoutStateRecord{}, err
	}
	var payoutID string
	if err := db.QueryRowContext(ctx, "SELECT id FROM wlt.payout_requests WHERE actor_type=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 1", actorType, actorID).Scan(&payoutID); err == nil {
		payout, readErr := ReadPayoutRequest(ctx, db, payoutID)
		if readErr != nil {
			return PayoutStateRecord{}, readErr
		}
		result.LatestPayout = &payout
	} else if !errors.Is(err, sql.ErrNoRows) {
		return PayoutStateRecord{}, err
	}
	return result, nil
}

func ReadPayoutRequest(ctx context.Context, db *sql.DB, payoutID string) (PayoutRequestRecord, error) {
	if db == nil || boundedText(payoutID, 1, 128) == "" {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	return readPayoutRequest(ctx, db, strings.TrimSpace(payoutID))
}

func readPayoutRequest(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, payoutID string) (PayoutRequestRecord, error) {
	var item PayoutRequestRecord
	var requested sql.NullInt64
	err := source.QueryRowContext(ctx, "SELECT id,actor_type,actor_id,amount_mode,requested_amount_minor,resolved_amount_minor,currency,destination_id,destination_version,status,policy_version,created_at FROM wlt.payout_requests WHERE id=$1", payoutID).Scan(&item.ID, &item.ActorType, &item.ActorID, &item.AmountMode, &requested, &item.ResolvedAmountMinor, &item.Currency, &item.DestinationID, &item.DestinationVersion, &item.Status, &item.PolicyVersion, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if requested.Valid {
		item.RequestedAmountMinor = &requested.Int64
	}
	return item, nil
}

func walletAccountCode(actorType string) string {
	switch actorType {
	case "partner":
		return "PARTNER_WALLET"
	case "captain":
		return "CAPTAIN_WALLET"
	case "field":
		return "FIELD_WALLET"
	default:
		return ""
	}
}

func formatInt(value int) string {
	return formatInt64(int64(value))
}

func formatInt64(value int64) string {
	if value == 0 {
		return "0"
	}
	return strings.TrimSpace(strconv.FormatInt(value, 10))
}
