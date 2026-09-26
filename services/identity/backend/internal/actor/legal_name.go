package actor

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

var ErrLegalNameNotFound = errors.New("verified actor legal name was not found")

type LegalNameRecord struct {
	ActorID                       string     `json:"actorId"`
	Version                       int        `json:"version"`
	GivenName                     string     `json:"givenName"`
	SecondName                    string     `json:"secondName"`
	ThirdName                     string     `json:"thirdName"`
	FamilyName                    string     `json:"familyName"`
	Status                        string     `json:"status"`
	Source                        string     `json:"source"`
	EvidenceReference             string     `json:"evidenceReference"`
	SubmittedByActorID            string     `json:"submittedByActorId"`
	SubmittedAt                   time.Time  `json:"submittedAt"`
	VerifiedByActorID             *string    `json:"verifiedByActorId,omitempty"`
	VerifiedAt                    *time.Time `json:"verifiedAt,omitempty"`
	VerificationEvidenceReference *string    `json:"verificationEvidenceReference,omitempty"`
}

type SubmitLegalNameInput struct {
	ActorID           string
	GivenName         string
	SecondName        string
	ThirdName         string
	FamilyName        string
	EvidenceReference string
	ActingActorID     string
	IdempotencyKey    string
	CorrelationID     string
}

type VerifyLegalNameInput struct {
	ActorID                       string
	Version                       int
	VerificationEvidenceReference string
	ActingActorID                 string
	IdempotencyKey                string
	CorrelationID                 string
}

type legalNameQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Service) SubmitLegalName(ctx context.Context, input SubmitLegalNameInput) (LegalNameRecord, bool, error) {
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.GivenName = strings.TrimSpace(input.GivenName)
	input.SecondName = strings.TrimSpace(input.SecondName)
	input.ThirdName = strings.TrimSpace(input.ThirdName)
	input.FamilyName = strings.TrimSpace(input.FamilyName)
	input.EvidenceReference = strings.TrimSpace(input.EvidenceReference)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if !legalNameText(input.ActorID, 128) || !legalNameText(input.GivenName, 80) || !legalNameText(input.SecondName, 80) || !legalNameText(input.ThirdName, 80) || !legalNameText(input.FamilyName, 80) || !legalNameText(input.EvidenceReference, 512) || !legalNameText(input.ActingActorID, 128) || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return LegalNameRecord{}, false, domain.ErrInvalidInput
	}
	requestHash := legalNameHash("SUBMIT", input.ActorID, input.GivenName, input.SecondName, input.ThirdName, input.FamilyName, input.EvidenceReference)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LegalNameRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:legal-name:"+input.ActorID); err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := requireIdentityOperationsOperator(ctx, tx, input.ActingActorID); err != nil {
		return LegalNameRecord{}, false, err
	}
	var existingActor string
	var existingVersion int
	var existingHash string
	err = tx.QueryRowContext(ctx, "SELECT actor_id,version,request_hash FROM identity_actor_legal_name_events WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&existingActor, &existingVersion, &existingHash)
	if err == nil {
		if existingHash != requestHash || existingActor != input.ActorID {
			return LegalNameRecord{}, false, domain.ErrConflict
		}
		item, readErr := readLegalNameVersion(ctx, tx, existingActor, existingVersion)
		if readErr != nil {
			return LegalNameRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return LegalNameRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return LegalNameRecord{}, false, err
	}
	var actorExists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_actors WHERE id=$1)", input.ActorID).Scan(&actorExists); err != nil {
		return LegalNameRecord{}, false, err
	}
	if !actorExists {
		return LegalNameRecord{}, false, domain.ErrNotFound
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM identity_actor_legal_name_versions WHERE actor_id=$1", input.ActorID).Scan(&version); err != nil {
		return LegalNameRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_actor_legal_name_versions(actor_id,version,given_name,second_name,third_name,family_name,evidence_reference,submitted_by_actor_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, input.ActorID, version, input.GivenName, input.SecondName, input.ThirdName, input.FamilyName, input.EvidenceReference, input.ActingActorID); err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := insertLegalNameEvent(ctx, tx, input.ActorID, version, "LEGAL_NAME_SUBMITTED", input.ActingActorID, input.EvidenceReference, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := auditTx(ctx, tx, "actor.legal_name_submitted", input.ActorID, "operator:"+input.ActingActorID, "success", input.CorrelationID, map[string]any{"version": version, "evidenceReference": input.EvidenceReference}); err != nil {
		return LegalNameRecord{}, false, err
	}
	item, err := readLegalNameVersion(ctx, tx, input.ActorID, version)
	if err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return LegalNameRecord{}, false, err
	}
	return item, false, nil
}

func (s *Service) VerifyLegalName(ctx context.Context, input VerifyLegalNameInput) (LegalNameRecord, bool, error) {
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.VerificationEvidenceReference = strings.TrimSpace(input.VerificationEvidenceReference)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if !legalNameText(input.ActorID, 128) || input.Version < 1 || !legalNameText(input.VerificationEvidenceReference, 512) || !legalNameText(input.ActingActorID, 128) || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return LegalNameRecord{}, false, domain.ErrInvalidInput
	}
	requestHash := legalNameHash("VERIFY", input.ActorID, input.VersionString(), input.VerificationEvidenceReference)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return LegalNameRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:legal-name:"+input.ActorID); err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := requireIdentityOperationsOperator(ctx, tx, input.ActingActorID); err != nil {
		return LegalNameRecord{}, false, err
	}
	var existingActor string
	var existingVersion int
	var existingHash string
	err = tx.QueryRowContext(ctx, "SELECT actor_id,version,request_hash FROM identity_actor_legal_name_events WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&existingActor, &existingVersion, &existingHash)
	if err == nil {
		if existingHash != requestHash || existingActor != input.ActorID || existingVersion != input.Version {
			return LegalNameRecord{}, false, domain.ErrConflict
		}
		item, readErr := readLegalNameVersion(ctx, tx, existingActor, existingVersion)
		if readErr != nil {
			return LegalNameRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return LegalNameRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return LegalNameRecord{}, false, err
	}
	var submittedBy string
	var status string
	err = tx.QueryRowContext(ctx, "SELECT submitted_by_actor_id,status FROM identity_actor_legal_name_versions WHERE actor_id=$1 AND version=$2 FOR UPDATE", input.ActorID, input.Version).Scan(&submittedBy, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return LegalNameRecord{}, false, domain.ErrNotFound
	}
	if err != nil {
		return LegalNameRecord{}, false, err
	}
	if submittedBy == input.ActingActorID || status != "PENDING_VERIFICATION" {
		return LegalNameRecord{}, false, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE identity_actor_legal_name_versions SET status='VERIFIED',verified_by_actor_id=$1,verified_at=clock_timestamp(),verification_evidence_reference=$2 WHERE actor_id=$3 AND version=$4 AND status='PENDING_VERIFICATION'`, input.ActingActorID, input.VerificationEvidenceReference, input.ActorID, input.Version); err != nil {
		return LegalNameRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_actor_legal_names(actor_id,current_version) VALUES($1,$2) ON CONFLICT(actor_id) DO UPDATE SET current_version=EXCLUDED.current_version,updated_at=clock_timestamp()`, input.ActorID, input.Version); err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := insertLegalNameEvent(ctx, tx, input.ActorID, input.Version, "LEGAL_NAME_VERIFIED", input.ActingActorID, input.VerificationEvidenceReference, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := auditTx(ctx, tx, "actor.legal_name_verified", input.ActorID, "operator:"+input.ActingActorID, "success", input.CorrelationID, map[string]any{"version": input.Version, "evidenceReference": input.VerificationEvidenceReference}); err != nil {
		return LegalNameRecord{}, false, err
	}
	item, err := readLegalNameVersion(ctx, tx, input.ActorID, input.Version)
	if err != nil {
		return LegalNameRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return LegalNameRecord{}, false, err
	}
	return item, false, nil
}

func (s *Service) ReadVerifiedLegalName(ctx context.Context, actorID string) (LegalNameRecord, error) {
	actorID = strings.TrimSpace(actorID)
	if !legalNameText(actorID, 128) {
		return LegalNameRecord{}, domain.ErrInvalidInput
	}
	return readCurrentLegalName(ctx, s.db, actorID)
}

func (s *Service) ReadPendingLegalName(ctx context.Context, actorID string) (LegalNameRecord, error) {
	actorID = strings.TrimSpace(actorID)
	if !legalNameText(actorID, 128) {
		return LegalNameRecord{}, domain.ErrInvalidInput
	}
	var version int
	err := s.db.QueryRowContext(ctx, `SELECT version FROM identity_actor_legal_name_versions WHERE actor_id=$1 AND status='PENDING_VERIFICATION' ORDER BY version DESC LIMIT 1`, actorID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return LegalNameRecord{}, ErrLegalNameNotFound
	}
	if err != nil {
		return LegalNameRecord{}, err
	}
	return readLegalNameVersion(ctx, s.db, actorID, version)
}

func (s *Service) RequireOperatorOperations(ctx context.Context, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if !legalNameText(actorID, 128) {
		return domain.ErrInvalidInput
	}
	return requireIdentityOperationsOperator(ctx, s.db, actorID)
}

func (input VerifyLegalNameInput) VersionString() string { return strconv.Itoa(input.Version) }

func legalNameText(value string, max int) bool {
	value = strings.TrimSpace(value)
	length := utf8.RuneCountInString(value)
	return value != "" && length <= max
}

func legalNameHash(values ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return hex.EncodeToString(hash[:])
}

func requireIdentityOperationsOperator(ctx context.Context, source legalNameQueryer, actorID string) error {
	var authorized bool
	err := source.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM identity_actor_roles r
		JOIN identity_actors a ON a.id=r.actor_id
		JOIN identity_operator_permissions p ON p.actor_id=r.actor_id AND p.permission='operations'
		WHERE r.actor_id=$1 AND r.role='operator' AND r.enabled=true AND r.activated_at IS NOT NULL AND a.security_enabled=true AND p.enabled=true
	)`, actorID).Scan(&authorized)
	if err != nil {
		return err
	}
	if !authorized {
		return domain.ErrForbidden
	}
	return nil
}

func insertLegalNameEvent(ctx context.Context, tx *sql.Tx, actorID string, version int, eventType, actingActorID, evidenceReference, idempotencyKey, requestHash, correlationID string) error {
	eventID, err := newActorID()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO identity_actor_legal_name_events(id,actor_id,version,event_type,acting_actor_id,evidence_reference,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, eventID, actorID, version, eventType, actingActorID, evidenceReference, idempotencyKey, requestHash, correlationID)
	return err
}

func readCurrentLegalName(ctx context.Context, source legalNameQueryer, actorID string) (LegalNameRecord, error) {
	return readLegalName(ctx, source, actorID, "")
}

func readLegalNameVersion(ctx context.Context, source legalNameQueryer, actorID string, version int) (LegalNameRecord, error) {
	return readLegalName(ctx, source, actorID, version)
}

func readLegalName(ctx context.Context, source legalNameQueryer, actorID string, version any) (LegalNameRecord, error) {
	query := `SELECT v.actor_id,v.version,v.given_name,v.second_name,v.third_name,v.family_name,v.status,v.source,v.evidence_reference,v.submitted_by_actor_id,v.submitted_at,v.verified_by_actor_id,v.verified_at,v.verification_evidence_reference
		FROM identity_actor_legal_name_versions v `
	var args []any
	if version == "" {
		query += `JOIN identity_actor_legal_names n ON n.actor_id=v.actor_id AND n.current_version=v.version WHERE v.actor_id=$1 AND v.status='VERIFIED'`
		args = []any{actorID}
	} else {
		query += `WHERE v.actor_id=$1 AND v.version=$2`
		args = []any{actorID, version}
	}
	var item LegalNameRecord
	var verifier, verificationEvidence sql.NullString
	var verifiedAt sql.NullTime
	err := source.QueryRowContext(ctx, query, args...).Scan(&item.ActorID, &item.Version, &item.GivenName, &item.SecondName, &item.ThirdName, &item.FamilyName, &item.Status, &item.Source, &item.EvidenceReference, &item.SubmittedByActorID, &item.SubmittedAt, &verifier, &verifiedAt, &verificationEvidence)
	if errors.Is(err, sql.ErrNoRows) {
		return LegalNameRecord{}, ErrLegalNameNotFound
	}
	if err != nil {
		return LegalNameRecord{}, err
	}
	if verifier.Valid {
		item.VerifiedByActorID = &verifier.String
	}
	if verifiedAt.Valid {
		item.VerifiedAt = &verifiedAt.Time
	}
	if verificationEvidence.Valid {
		item.VerificationEvidenceReference = &verificationEvidence.String
	}
	return item, nil
}
