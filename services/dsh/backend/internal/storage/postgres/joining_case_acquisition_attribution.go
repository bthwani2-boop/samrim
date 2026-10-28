package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// CanAttributeJoiningCaseAcquisition is shared by the service preflight and
// locked transaction to avoid authorizing a different origin or case state.
func CanAttributeJoiningCaseAcquisition(c JoiningCaseRecord) bool {
	return (c.Origin == "control_panel" || c.Origin == "self_service") && c.OriginatingFieldActorID == "" && c.StoreID == "" && (c.State == "draft" || c.State == "submitted" || c.State == "needs_correction")
}

// AttributeJoiningCaseAcquisition records immutable acquisition provenance
// before Store approval; it does not change the original intake owner.
func AttributeJoiningCaseAcquisition(ctx context.Context, db *sql.DB, caseID, fieldActorID, operatorActorID, reason string, expectedVersion int, idempotencyKey, correlationID string) (JoiningCaseResult, error) {
	caseID, fieldActorID, operatorActorID, reason = strings.TrimSpace(caseID), strings.TrimSpace(fieldActorID), strings.TrimSpace(operatorActorID), strings.TrimSpace(reason)
	if db == nil || caseID == "" || len(caseID) > 128 || fieldActorID == "" || len(fieldActorID) > 128 || operatorActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 || utf8.RuneCountInString(reason) < 8 || utf8.RuneCountInString(reason) > 400 {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	hash := hashFacts("attribution-v1", caseID, fieldActorID, operatorActorID, reason, strconv.Itoa(expectedVersion))
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err = lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, replayed, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, hash, caseID, "acquisition_attribution")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if replayed {
		if result.Case.OriginatingFieldActorID != fieldActorID {
			return JoiningCaseResult{}, ErrJoiningCaseIdempotency
		}
		if err = tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	var locked string
	if err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.joining_cases WHERE id=$1 FOR UPDATE", caseID).Scan(&locked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, ErrJoiningCaseNotFound
		}
		return JoiningCaseResult{}, err
	}
	result, err = readJoiningCaseTx(ctx, tx, caseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	c := result.Case
	if c.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if !CanAttributeJoiningCaseAcquisition(c) {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	var updatedID string
	err = tx.QueryRowContext(ctx, "UPDATE dsh.joining_cases SET originating_field_actor_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 AND originating_field_actor_id IS NULL RETURNING id", caseID, fieldActorID, expectedVersion).Scan(&updatedID)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("record joining attribution: %w", err)
	}
	result, err = readJoiningCaseTx(ctx, tx, updatedID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err = recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, hash, result.Case, "acquisition_attribution"); err != nil {
		return JoiningCaseResult{}, err
	}
	if err = auditJoiningCaseTx(ctx, tx, "joining_case_acquisition_attributed", idempotencyKey, correlationID, operatorActorID, caseID, c.State, c.State, result.Case.Version, hash, c.PartnerActorID, c.StoreID, "field="+fieldActorID+"; "+reason); err != nil {
		return JoiningCaseResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	return result, nil
}
