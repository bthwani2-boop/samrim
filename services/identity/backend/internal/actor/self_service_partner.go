package actor

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

// AdmitSelfRegisteredPartnerTx admits the *same* human actor already verified by
// an active Client session. It never enables disabled accounts, reactivates an
// existing Partner role, or replaces a Partner credential. Store access remains
// independently scoped by DSH to the actor's own Stores.
func (s *Service) AdmitSelfRegisteredPartnerTx(ctx context.Context, tx *sql.Tx, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return domain.ErrUnauthenticated
	}
	var passwordHash string
	err := tx.QueryRowContext(ctx, `SELECT c.password_hash
FROM identity_actors a
JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='client'
JOIN identity_password_credentials c ON c.actor_id=a.id AND c.role='client'
WHERE a.id=$1 AND a.security_enabled=true AND r.enabled=true
FOR UPDATE OF a,r,c`, actorID).Scan(&passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrForbidden
	}
	if err != nil {
		return err
	}

	// Existing admitted, disabled or unactivated Partner roles must follow
	// their current governed login/recovery route, not be overwritten here.
	var existing bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
SELECT 1 FROM identity_actor_roles WHERE actor_id=$1 AND role='partner')`, actorID).Scan(&existing); err != nil {
		return err
	}
	if existing {
		return domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_actor_roles
(actor_id,role,enabled,activated_at,version) VALUES($1,'partner',true,clock_timestamp(),1)`, actorID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_password_credentials
(actor_id,role,password_hash,version) VALUES($1,'partner',$2,1)`, actorID, passwordHash); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "actor_role.provisioned", actorID, actorID, "success", "", map[string]any{"role": "partner", "workload": "verified-self-registration"}); err != nil {
		return err
	}
	return auditTx(ctx, tx, "actor_role.activated", actorID, actorID, "success", "", map[string]any{"role": "partner", "workload": "verified-self-registration"})
}
