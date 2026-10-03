package actor

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

// ProvisionExistingTrustedWithContext admits a managed role for one already-known
// canonical actor. Unlike phone-based provisioning, this path never creates or
// re-resolves a Human Actor.
func (s *Service) ProvisionExistingTrustedWithContext(ctx context.Context, caller, actorID, role, actingActorID, correlationID string) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	actingActorID = strings.TrimSpace(actingActorID)
	correlationID = strings.TrimSpace(correlationID)
	role = strings.ToLower(strings.TrimSpace(role))
	if actorID == "" || !domain.CanProvisionRole(caller, role) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	if len(correlationID) < 8 || len(correlationID) > 128 {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}
	if (caller == "control-panel" || caller == "dsh") && actingActorID == "" {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:actor:"+actorID); err != nil {
		return domain.ActorRoleView{}, err
	}

	var actor domain.Actor
	if err := tx.QueryRowContext(ctx, `SELECT id,phone_e164,security_enabled,version
		FROM identity_actors WHERE id=$1 FOR UPDATE`, actorID).Scan(&actor.ID, &actor.PhoneE164, &actor.SecurityEnabled, &actor.Version); errors.Is(err, sql.ErrNoRows) {
		return domain.ActorRoleView{}, domain.ErrNotFound
	} else if err != nil {
		return domain.ActorRoleView{}, err
	}
	if !actor.SecurityEnabled {
		return domain.ActorRoleView{}, domain.ErrActorSecurityDisabled
	}

	var enabled bool
	var activatedAt sql.NullTime
	var roleVersion int
	roleCreated := false
	err = tx.QueryRowContext(ctx, `SELECT enabled,activated_at,version FROM identity_actor_roles
		WHERE actor_id=$1 AND role=$2 FOR UPDATE`, actor.ID, role).Scan(&enabled, &activatedAt, &roleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO identity_actor_roles(actor_id,role,enabled,activated_at,version)
			VALUES($1,$2,true,NULL,1)`, actor.ID, role); err != nil {
			return domain.ActorRoleView{}, err
		}
		enabled, roleVersion, roleCreated = true, 1, true
		principal := caller + ":" + actingActorID
		if err := auditTx(ctx, tx, "actor_role.provisioned", actor.ID, principal, "success", correlationID, map[string]any{
			"role": role, "workload": caller, "actingActorId": actingActorID, "actorLocator": "actor_id",
		}); err != nil {
			return domain.ActorRoleView{}, err
		}
	} else if err != nil {
		return domain.ActorRoleView{}, err
	} else if !enabled {
		return domain.ActorRoleView{}, domain.ErrConflict
	}

	if role == "operator" {
		for _, permission := range domain.OperatorPermissions() {
			if _, err := tx.ExecContext(ctx, `INSERT INTO identity_operator_permissions(actor_id,permission,enabled,version,changed_by_actor_id,reason)
				VALUES($1,$2,false,1,NULL,$3) ON CONFLICT(actor_id,permission) DO NOTHING`, actor.ID, permission, permission+" permission not granted"); err != nil {
				return domain.ActorRoleView{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.ActorRoleView{}, err
	}
	var activated *time.Time
	if activatedAt.Valid {
		value := activatedAt.Time
		activated = &value
	}
	return domain.ActorRoleView{
		ActorID: actor.ID, PhoneE164: actor.PhoneE164, Role: role, Enabled: enabled,
		ActivatedAt: activated, SecurityEnabled: actor.SecurityEnabled, ActorVersion: actor.Version,
		RoleVersion: roleVersion, CredentialVersion: 0, ActorCreated: false, RoleCreated: roleCreated,
	}, nil
}
