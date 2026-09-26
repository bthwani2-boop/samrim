package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

var (
	ErrFinancialProfileNotFound     = errors.New("partner financial profile was not found")
	ErrFinancialProfileExists       = errors.New("partner financial profile already exists")
	ErrFinancialProfileInvalidInput = domain.ErrFinancialProfileInvalidInput
	ErrFinancialProfileState        = domain.ErrFinancialProfileState
)

type PartnerFinancialProfileRecord struct {
	ID                 string
	JoiningCaseID      string
	PartnerActorID     string
	Origin             string
	CommissionRateBps  int
	SettlementPeriod   string
	TermsPolicyVersion string
	RoundingUnitMinor  int64
	State              string
	Version            int
	ActivatedAt        *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type PreparePartnerFinancialProfileInput struct {
	JoiningCaseID      string
	PartnerActorID     string
	Origin             string
	CommissionRateBps  int
	SettlementPeriod   string
	TermsPolicyVersion string
	IdempotencyKey     string
	CorrelationID      string
}

type ActivatePartnerFinancialProfileInput struct {
	ProfileID       string
	ExpectedVersion int
	IdempotencyKey  string
	CorrelationID   string
	ActorID         string
}

func HashPreparePartnerFinancialProfile(input PreparePartnerFinancialProfileInput) string {
	if strings.TrimSpace(input.TermsPolicyVersion) == "" {
		return hashFacts("partner-financial-profile-prepare", strings.TrimSpace(input.JoiningCaseID), strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.Origin), fmt.Sprintf("%d", input.CommissionRateBps), strings.TrimSpace(input.SettlementPeriod))
	}
	return hashFacts("partner-financial-profile-prepare", strings.TrimSpace(input.JoiningCaseID), strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.Origin), fmt.Sprintf("%d", input.CommissionRateBps), strings.TrimSpace(input.SettlementPeriod), strings.TrimSpace(input.TermsPolicyVersion))
}

func HashActivatePartnerFinancialProfile(input ActivatePartnerFinancialProfileInput) string {
	return hashFacts("partner-financial-profile-activate", strings.TrimSpace(input.ProfileID), fmt.Sprintf("%d", input.ExpectedVersion))
}

func PreparePartnerFinancialProfile(ctx context.Context, db *sql.DB, input PreparePartnerFinancialProfileInput) (PartnerFinancialProfileRecord, bool, error) {
	input.JoiningCaseID = strings.TrimSpace(input.JoiningCaseID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.Origin = strings.TrimSpace(input.Origin)
	input.SettlementPeriod = strings.TrimSpace(input.SettlementPeriod)
	input.TermsPolicyVersion = strings.TrimSpace(input.TermsPolicyVersion)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || domain.ValidateFinancialProfile(input.JoiningCaseID, input.PartnerActorID, input.Origin, input.SettlementPeriod, input.CommissionRateBps) != nil || (input.TermsPolicyVersion != "" && !strings.HasPrefix(input.TermsPolicyVersion, "partner-financial-terms:v")) || len(input.TermsPolicyVersion) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerFinancialProfileRecord{}, false, domain.ErrFinancialProfileInvalidInput
	}
	requestHash := HashPreparePartnerFinancialProfile(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-financial-profile:prepare:"+input.IdempotencyKey); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-financial-profile:identity:"+input.JoiningCaseID+":"+input.PartnerActorID); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	var storedHash, existingID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,profile_id FROM wlt.partner_financial_profile_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingID)
	if err == nil {
		if storedHash != requestHash {
			return PartnerFinancialProfileRecord{}, false, ErrIdempotencyConflict
		}
		profile, readErr := readPartnerFinancialProfile(ctx, tx, existingID)
		if readErr != nil {
			return PartnerFinancialProfileRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerFinancialProfileRecord{}, false, err
		}
		return profile, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialProfileRecord{}, false, err
	}
	var existingProfileID string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.partner_financial_profiles WHERE joining_case_id=$1 OR partner_actor_id=$2", input.JoiningCaseID, input.PartnerActorID).Scan(&existingProfileID); err == nil {
		return PartnerFinancialProfileRecord{}, false, ErrFinancialProfileExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialProfileRecord{}, false, err
	}
	profileID, err := newID("financial_profile")
	if err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_financial_profiles(id,joining_case_id,partner_actor_id,origin,commission_rate_bps,settlement_period,idempotency_key,request_hash,terms_policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, profileID, input.JoiningCaseID, input.PartnerActorID, input.Origin, input.CommissionRateBps, input.SettlementPeriod, input.IdempotencyKey, requestHash, input.TermsPolicyVersion); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if err := insertFinancialProfileEvent(ctx, tx, profileID, "PROFILE_PREPARED", input.IdempotencyKey, requestHash, input.CorrelationID, nil, "", domain.ProfilePendingBinding, 1, input.CommissionRateBps, input.SettlementPeriod, input.TermsPolicyVersion); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	profile, err := ReadPartnerFinancialProfile(ctx, db, profileID)
	return profile, false, err
}

func ActivatePartnerFinancialProfile(ctx context.Context, db *sql.DB, input ActivatePartnerFinancialProfileInput) (PartnerFinancialProfileRecord, bool, error) {
	input.ProfileID = strings.TrimSpace(input.ProfileID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	if db == nil || input.ProfileID == "" || input.ExpectedVersion < 1 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 || input.ActorID == "" {
		return PartnerFinancialProfileRecord{}, false, domain.ErrFinancialProfileInvalidInput
	}
	requestHash := HashActivatePartnerFinancialProfile(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-financial-profile:activate:"+input.IdempotencyKey); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	var storedHash, existingProfileID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,profile_id FROM wlt.partner_financial_profile_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingProfileID)
	if err == nil {
		if storedHash != requestHash || existingProfileID != input.ProfileID {
			return PartnerFinancialProfileRecord{}, false, ErrIdempotencyConflict
		}
		profile, readErr := readPartnerFinancialProfile(ctx, tx, input.ProfileID)
		if readErr != nil {
			return PartnerFinancialProfileRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerFinancialProfileRecord{}, false, err
		}
		return profile, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialProfileRecord{}, false, err
	}
	var current PartnerFinancialProfileRecord
	if err := scanPartnerFinancialProfile(tx.QueryRowContext(ctx, `SELECT id,joining_case_id,partner_actor_id,origin,commission_rate_bps,settlement_period,rounding_unit_minor,state,version,activated_at,created_at,updated_at,COALESCE(terms_policy_version,'') FROM wlt.partner_financial_profiles WHERE id=$1 FOR UPDATE`, input.ProfileID), &current); errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialProfileRecord{}, false, ErrFinancialProfileNotFound
	} else if err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if current.Version != input.ExpectedVersion {
		return PartnerFinancialProfileRecord{}, false, ErrVersionConflict
	}
	if current.State == domain.ProfileActive {
		return PartnerFinancialProfileRecord{}, false, ErrFinancialProfileState
	}
	if !domain.CanActivateFinancialProfile(current.State) {
		return PartnerFinancialProfileRecord{}, false, ErrFinancialProfileState
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.partner_financial_profiles SET state=$2,version=version+1,activated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND version=$3`, input.ProfileID, domain.ProfileActive, input.ExpectedVersion); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if err := insertFinancialProfileEvent(ctx, tx, input.ProfileID, "PROFILE_ACTIVATED", input.IdempotencyKey, requestHash, input.CorrelationID, &input.ActorID, current.State, domain.ProfileActive, current.Version+1, current.CommissionRateBps, current.SettlementPeriod, current.TermsPolicyVersion); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerFinancialProfileRecord{}, false, err
	}
	profile, err := ReadPartnerFinancialProfile(ctx, db, input.ProfileID)
	return profile, false, err
}

func ReadPartnerFinancialProfile(ctx context.Context, db *sql.DB, profileID string) (PartnerFinancialProfileRecord, error) {
	if db == nil || strings.TrimSpace(profileID) == "" {
		return PartnerFinancialProfileRecord{}, domain.ErrFinancialProfileInvalidInput
	}
	return readPartnerFinancialProfile(ctx, db, strings.TrimSpace(profileID))
}

func readPartnerFinancialProfile(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, profileID string) (PartnerFinancialProfileRecord, error) {
	var profile PartnerFinancialProfileRecord
	err := scanPartnerFinancialProfile(source.QueryRowContext(ctx, `SELECT id,joining_case_id,partner_actor_id,origin,commission_rate_bps,settlement_period,rounding_unit_minor,state,version,activated_at,created_at,updated_at,COALESCE(terms_policy_version,'') FROM wlt.partner_financial_profiles WHERE id=$1`, profileID), &profile)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialProfileRecord{}, ErrFinancialProfileNotFound
	}
	return profile, err
}

func scanPartnerFinancialProfile(row rowScanner, profile *PartnerFinancialProfileRecord) error {
	var activatedAt sql.NullTime
	err := row.Scan(&profile.ID, &profile.JoiningCaseID, &profile.PartnerActorID, &profile.Origin, &profile.CommissionRateBps, &profile.SettlementPeriod, &profile.RoundingUnitMinor, &profile.State, &profile.Version, &activatedAt, &profile.CreatedAt, &profile.UpdatedAt, &profile.TermsPolicyVersion)
	if err != nil {
		return err
	}
	if activatedAt.Valid {
		value := activatedAt.Time
		profile.ActivatedAt = &value
	}
	return nil
}

func insertFinancialProfileEvent(ctx context.Context, tx *sql.Tx, profileID, eventType, idempotencyKey, requestHash, correlationID string, actorID *string, fromState, toState string, version, commissionRateBps int, settlementPeriod, termsPolicyVersion string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_financial_profile_events(profile_id,event_type,idempotency_key,request_hash,correlation_id,actor_id,from_state,to_state,version,commission_rate_bps,settlement_period,terms_policy_version) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12)`, profileID, eventType, idempotencyKey, requestHash, correlationID, actorID, fromState, toState, version, commissionRateBps, settlementPeriod, termsPolicyVersion)
	return err
}
