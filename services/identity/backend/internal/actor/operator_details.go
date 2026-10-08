package actor

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func (s *Service) UpdateOperatorRoleDetails(ctx context.Context, caller, actingActorID, correlationID, actorID string, input domain.OperatorRoleDetailsUpdateRequest) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actingActorID, actorID = strings.TrimSpace(actingActorID), strings.TrimSpace(actorID)
	input.JobTitle, input.Department = strings.TrimSpace(input.JobTitle), strings.TrimSpace(input.Department)
	correlationLength := utf8.RuneCountInString(strings.TrimSpace(correlationID))
	if caller != "control-panel" || actingActorID == "" || actorID == "" || input.ExpectedVersion < 1 || !validOperatorDetails(input.JobTitle, input.Department) || correlationLength < 8 || correlationLength > 128 {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.ActorRoleView{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.requireOperatorPermissionAdministrator(ctx, tx, actingActorID); err != nil {
		return domain.ActorRoleView{}, err
	}
	var currentTitle, currentDepartment string
	var version int
	err = tx.QueryRowContext(ctx, "SELECT job_title,department,version FROM identity_actor_roles WHERE actor_id=$1 AND role='operator' FOR UPDATE", actorID).Scan(&currentTitle, &currentDepartment, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorRoleView{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	if version != input.ExpectedVersion {
		return domain.ActorRoleView{}, domain.ErrConflict
	}
	if currentTitle != input.JobTitle || currentDepartment != input.Department {
		result, err := tx.ExecContext(ctx, `UPDATE identity_actor_roles
			SET job_title=$1,department=$2,version=version+1,updated_at=clock_timestamp()
			WHERE actor_id=$3 AND role='operator' AND version=$4`, input.JobTitle, input.Department, actorID, input.ExpectedVersion)
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		if updated != 1 {
			return domain.ActorRoleView{}, domain.ErrConflict
		}
		if err := auditTx(ctx, tx, "operator.details_updated", actorID, "control-panel:"+actingActorID, "success", correlationID, map[string]any{
			"jobTitleChanged":   currentTitle != input.JobTitle,
			"departmentChanged": currentDepartment != input.Department,
		}); err != nil {
			return domain.ActorRoleView{}, err
		}
	}
	view, err := readOperatorProfileRole(ctx, tx, actorID)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ActorRoleView{}, err
	}
	return view, nil
}
