package actor

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

// ResolveClientShareRecipient performs an exact, purpose-restricted lookup.
// It is not a general client directory and its result must never be exposed
// directly to a mobile user (including negative responses).
func (s *Service) ResolveClientShareRecipient(ctx context.Context, caller, rawPhone string) (string, error) {
	if strings.TrimSpace(caller) != "dsh" {
		return "", errors.New("share recipient lookup is restricted to DSH")
	}
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil || phone != strings.TrimSpace(rawPhone) {
		return "", errors.New("invalid share recipient phone")
	}
	var actorID string
	err = s.db.QueryRowContext(ctx, `SELECT a.id FROM identity_actors a
        JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='client'
        WHERE a.phone_e164=$1 AND a.security_enabled=true AND r.enabled=true`, phone).Scan(&actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return actorID, err
}
