package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// CreateSelfServiceJoiningCase shares the canonical creation transaction and
// audit writer with Operator and Field cases, but never grants a Partner role.
func CreateSelfServiceJoiningCase(ctx context.Context, db *sql.DB, input CreateJoiningCaseInput) (JoiningCaseResult, error) {
	input.Origin = "self_service"
	input.OriginatingFieldActorID = ""
	input.ApplicantActorID = strings.TrimSpace(input.ActingActorID)
	return createJoiningCase(ctx, db, input)
}

// Only a verified Identity client session with the exact canonical phone may
// request this read. The service revalidates Identity on each call.
func ReadSelfServiceJoiningCase(ctx context.Context, db *sql.DB, actorID, phone string) (JoiningCaseResult, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(phone) == "" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	var caseID string
	err := db.QueryRowContext(ctx, "SELECT id FROM dsh.joining_cases WHERE contact_phone_e164=$1 AND applicant_actor_id=$2 AND origin='self_service' ORDER BY created_at DESC LIMIT 1", phone, actorID).Scan(&caseID)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseNotFound
	}
	if err != nil {
		return JoiningCaseResult{}, err
	}
	return ReadJoiningCase(ctx, db, caseID)
}

func ReadSelfServiceApplicantBinding(ctx context.Context, db *sql.DB, caseID string) (string, error) {
	if db == nil || strings.TrimSpace(caseID) == "" {
		return "", ErrJoiningCaseState
	}
	var actorID string
	err := db.QueryRowContext(ctx, "SELECT applicant_actor_id FROM dsh.joining_cases WHERE id=$1 AND origin='self_service' AND applicant_actor_id IS NOT NULL", strings.TrimSpace(caseID)).Scan(&actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrJoiningCaseNotFound
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(actorID) == "" {
		return "", ErrJoiningCaseState
	}
	return actorID, nil
}
