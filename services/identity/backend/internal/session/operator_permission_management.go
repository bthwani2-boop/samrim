package session

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/lib/pq"
)

var (
	ErrOperatorAdminForbidden      = errors.New("only original active Operator may administer permissions")
	ErrOperatorAdminTargetNotFound = errors.New("current target Operator not found")
	ErrOperatorAdminConflict       = errors.New("Operator permission version or operation conflict")
	ErrOperatorAdminInvalid        = errors.New("invalid Operator permission command")
)

var operatorAdminID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
var operatorAdminOperationID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$`)

// OperatorPermissionCommand is never sufficient authority by itself. The
// Identity owner resolves the authenticated original Operator from a bearer.
type OperatorPermissionCommand struct {
	TargetActorID   string `json:"targetActorId"`
	Permission      string `json:"permission"`
	State           string `json:"state"`
	ExpectedVersion int64  `json:"expectedVersion"`
	OperationID     string `json:"operationId"`
	Reason          string `json:"reason"`
}

type OperatorPermissionResult struct {
	TargetActorID string `json:"targetActorId"`
	Permission    string `json:"permission"`
	State         string `json:"state"`
	Version       int64  `json:"version"`
}

func validateOperatorPermissionCommand(command OperatorPermissionCommand) error {
	reasonLength := utf8.RuneCountInString(command.Reason)
	if !operatorAdminID.MatchString(command.TargetActorID) ||
		!isOperatorPermission(command.Permission) ||
		(command.State != "ACTIVE" && command.State != "REVOKED") ||
		command.ExpectedVersion < 0 ||
		!operatorAdminOperationID.MatchString(command.OperationID) ||
		command.Reason != strings.TrimSpace(command.Reason) ||
		!utf8.ValidString(command.Reason) ||
		reasonLength < 10 || reasonLength > 500 ||
		strings.ContainsAny(command.Reason, "\r\n\x00") {
		return ErrOperatorAdminInvalid
	}
	return nil
}

// ManageOperatorPermission is Identity's sole bounded permission admin writer.
// A current opaque Operator bearer MUST belong to the original one-time
// bootstrapped Operator. No scope, including finance or platform_policies,
// delegates grant/revoke authority. Every mutation invalidates target Operator
// sessions in the same owner SQL transaction as its version and audit.
func (r *PostgresReader) ManageOperatorPermission(
	ctx context.Context, authorization string, command OperatorPermissionCommand,
) (OperatorPermissionResult, error) {
	if err := validateOperatorPermissionCommand(command); err != nil {
		return OperatorPermissionResult{}, err
	}
	digest, err := bearerDigest(authorization)
	if err != nil {
		return OperatorPermissionResult{}, err
	}
	tx, err := r.begin(ctx, false)
	if err != nil {
		return OperatorPermissionResult{}, err
	}
	defer tx.Rollback()

	// A forged role/actor header, non-root Operator, stale permission grant,
	// suspended actor or expired bearer cannot become the original admin.
	// PostgreSQL's clock is evaluated after any row-lock wait.
	var adminActor string
	err = tx.QueryRowContext(ctx, `SELECT a.id FROM auth_sessions s
        JOIN actors a ON a.id=s.actor_id
        JOIN actor_roles ar ON ar.actor_id=s.actor_id AND ar.role=s.role
        JOIN operator_bootstrap b ON b.actor_id=a.id AND b.singleton=true
        WHERE s.token_digest=$1 AND s.role='operator'
          AND s.revoked_at IS NULL
          AND s.issued_at <= clock_timestamp() AND s.expires_at > clock_timestamp()
          AND a.status='ACTIVE' AND ar.status='ACTIVE'
          AND a.auth_version=s.actor_version AND ar.version=s.role_version
        FOR UPDATE OF s,a,ar,b`, digest[:]).Scan(&adminActor)
	if errors.Is(err, sql.ErrNoRows) {
		return OperatorPermissionResult{}, ErrOperatorAdminForbidden
	}
	if err != nil {
		return OperatorPermissionResult{}, err
	}
	if adminActor == command.TargetActorID {
		// Root Owner continuity is a separate protected pathway.
		return OperatorPermissionResult{}, ErrOperatorAdminForbidden
	}

	// Serialize concurrent mutation of the same target before observing the
	// operation ID, permission version and standing. No stale privileges.
	var roleVersion int64
	var actorStatus, roleStatus string
	err = tx.QueryRowContext(ctx, `SELECT ar.version,a.status,ar.status
        FROM actors a JOIN actor_roles ar ON ar.actor_id=a.id
        WHERE a.id=$1 AND ar.role='operator'
        FOR UPDATE OF a,ar`, command.TargetActorID).Scan(&roleVersion, &actorStatus, &roleStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return OperatorPermissionResult{}, ErrOperatorAdminTargetNotFound
	}
	if err != nil {
		return OperatorPermissionResult{}, err
	}

	// Retry of the same confirmed operation returns its stored result and
	// never re-applies audit, grant or role-version invalidation.
	var storedAdmin, storedTarget, storedPermission, storedState, storedReason string
	var storedExpected, storedResultVersion int64
	err = tx.QueryRowContext(ctx, `SELECT admin_actor_id,target_actor_id,permission,state,
            expected_version,reason,result_version FROM operator_permission_commands
        WHERE operation_id=$1 FOR UPDATE`, command.OperationID).
		Scan(&storedAdmin, &storedTarget, &storedPermission, &storedState,
			&storedExpected, &storedReason, &storedResultVersion)
	if err == nil {
		if storedAdmin != adminActor || storedTarget != command.TargetActorID ||
			storedPermission != command.Permission || storedState != command.State ||
			storedExpected != command.ExpectedVersion || storedReason != command.Reason {
			return OperatorPermissionResult{}, ErrOperatorAdminConflict
		}
		if err = tx.Commit(); err != nil {
			return OperatorPermissionResult{}, err
		}
		return OperatorPermissionResult{
			TargetActorID: command.TargetActorID, Permission: command.Permission,
			State: command.State, Version: storedResultVersion,
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OperatorPermissionResult{}, err
	}
	// Recorded exact retries stay observable after target suspension, but a
	// new grant/revoke cannot act on an inactive actor or role.
	if actorStatus != "ACTIVE" || roleStatus != "ACTIVE" {
		return OperatorPermissionResult{}, ErrOperatorAdminTargetNotFound
	}

	var previousState string
	var previousVersion int64
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM operator_permissions
        WHERE actor_id=$1 AND permission=$2 FOR UPDATE`,
		command.TargetActorID, command.Permission).Scan(&previousState, &previousVersion)
	missing := errors.Is(err, sql.ErrNoRows)
	if err != nil && !missing {
		return OperatorPermissionResult{}, err
	}
	if missing {
		previousVersion = 0
	}
	if previousVersion != command.ExpectedVersion || (!missing && previousState == command.State) ||
		(missing && command.State == "REVOKED") {
		return OperatorPermissionResult{}, ErrOperatorAdminConflict
	}

	nextVersion := previousVersion + 1
	if missing {
		_, err = tx.ExecContext(ctx, `INSERT INTO operator_permissions
            (actor_id,role,permission,state,version) VALUES($1,'operator',$2,$3,$4)`,
			command.TargetActorID, command.Permission, command.State, nextVersion)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE operator_permissions SET state=$3,version=$4,
            updated_at=clock_timestamp() WHERE actor_id=$1 AND permission=$2`,
			command.TargetActorID, command.Permission, command.State, nextVersion)
	}
	if err != nil {
		return OperatorPermissionResult{}, err
	}

	// Version invalidation makes even future-issued/stale cached credentials
	// unusable. Do not revoke future-issued test rows before their issued_at,
	// because auth_sessions has a revoked_at >= issued_at check.
	_, err = tx.ExecContext(ctx, `UPDATE actor_roles
        SET version=version+1,updated_at=clock_timestamp()
        WHERE actor_id=$1 AND role='operator' AND status='ACTIVE'`, command.TargetActorID)
	if err != nil {
		return OperatorPermissionResult{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
        WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL
          AND issued_at <= clock_timestamp()`, command.TargetActorID)
	if err != nil {
		return OperatorPermissionResult{}, err
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO operator_permission_commands
        (operation_id,admin_actor_id,target_actor_id,permission,state,expected_version,
            reason,result_version,previous_state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		command.OperationID, adminActor, command.TargetActorID, command.Permission,
		command.State, command.ExpectedVersion, command.Reason, nextVersion,
		sql.NullString{String: previousState, Valid: !missing})
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && string(pqErr.Code) == "23505" {
			return OperatorPermissionResult{}, ErrOperatorAdminConflict
		}
		return OperatorPermissionResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return OperatorPermissionResult{}, err
	}
	return OperatorPermissionResult{
		TargetActorID: command.TargetActorID, Permission: command.Permission,
		State: command.State, Version: nextVersion,
	}, nil
}
