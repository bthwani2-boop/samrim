package authentication

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
)

const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$nl2x4UwETv8mM+eRDPVuvQ$C1rH4q7MVn4IuThQWK4cmDjPmF5HBNafRD7OMiZRpIY"

const (
	passwordSubjectRiskThreshold = 5
	passwordSourceFailureLimit   = 30
	passwordBackoffStep          = 250 * time.Millisecond
	passwordBackoffMaximum       = 2 * time.Second
)

type Service struct {
	db       *sql.DB
	actors   *actor.Service
	sessions *session.Service
}

func New(db *sql.DB, actors *actor.Service, sessions *session.Service) *Service {
	return &Service{db: db, actors: actors, sessions: sessions}
}

func (s *Service) LoginClient(ctx context.Context, input domain.PasswordLoginRequest, ipHash string) (domain.TokenPair, error) {
	return s.loginPassword(ctx, input.Phone, input.Password, "client", input.ClientInstanceId, ipHash)
}

func (s *Service) LoginManaged(ctx context.Context, input domain.ManagedPasswordLoginRequest, ipHash string) (domain.TokenPair, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsManagedRole(role) {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	return s.loginPassword(ctx, input.Phone, input.Password, role, input.ClientInstanceId, ipHash)
}

func (s *Service) loginPassword(ctx context.Context, rawPhone, password, role, rawDevice, ipHash string) (domain.TokenPair, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	device, err := identitysecurity.NormalizeClientInstanceId(rawDevice)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	if len(strings.TrimSpace(ipHash)) != 64 {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	limited, backoff, reservationID, err := s.passwordAdmission(ctx, phone, role, ipHash)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if limited {
		return domain.TokenPair{}, domain.ErrRateLimited
	}
	if err := waitPasswordBackoff(ctx, backoff); err != nil {
		return domain.TokenPair{}, err
	}
	a, hash, _, lookupErr := s.actors.PasswordCredential(ctx, phone, role)
	if errors.Is(lookupErr, domain.ErrNotFound) {
		_ = identitysecurity.VerifyPassword(dummyPasswordHash, password)
		limited, recordErr := s.recordPasswordFailure(ctx, phone, role, ipHash, reservationID)
		if recordErr != nil {
			return domain.TokenPair{}, recordErr
		}
		if limited {
			return domain.TokenPair{}, domain.ErrRateLimited
		}
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	if lookupErr != nil {
		_, _ = s.recordPasswordFailure(ctx, phone, role, ipHash, reservationID)
		return domain.TokenPair{}, lookupErr
	}
	if !identitysecurity.VerifyPassword(hash, password) {
		limited, recordErr := s.recordPasswordFailure(ctx, phone, role, ipHash, reservationID)
		if recordErr != nil {
			return domain.TokenPair{}, recordErr
		}
		if limited {
			return domain.TokenPair{}, domain.ErrRateLimited
		}
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.releaseReservation(ctx, reservationID)
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var currentHash string
	var enabled, securityEnabled bool
	if err := tx.QueryRowContext(ctx, `SELECT c.password_hash,r.enabled,a.security_enabled FROM identity_password_credentials c
JOIN identity_actor_roles r ON r.actor_id=c.actor_id AND r.role=c.role JOIN identity_actors a ON a.id=c.actor_id
WHERE c.actor_id=$1 AND c.role=$2 FOR UPDATE OF c,r,a`, a.ID, role).Scan(&currentHash, &enabled, &securityEnabled); err != nil || !enabled || !securityEnabled || currentHash != hash {
		s.releaseReservation(ctx, reservationID)
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	if err := s.recordPasswordSuccessTx(ctx, tx, phone, role, ipHash, reservationID); err != nil {
		s.releaseReservation(ctx, reservationID)
		return domain.TokenPair{}, err
	}
	if identitysecurity.NeedsPasswordRehash(currentHash) {
		upgradedHash, hashErr := identitysecurity.HashPassword(password)
		if hashErr != nil {
			return domain.TokenPair{}, hashErr
		}
		if _, hashErr = tx.ExecContext(ctx, "UPDATE identity_password_credentials SET password_hash=$1,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$2 AND role=$3", upgradedHash, a.ID, role); hashErr != nil {
			return domain.TokenPair{}, hashErr
		}
		if err := auditTx(ctx, tx, "credential.password_rehashed", a.ID, a.ID, "success", "", map[string]any{"role": role, "blocklistVersion": identitysecurity.PasswordBlocklistVersion()}); err != nil {
			return domain.TokenPair{}, err
		}
	}
	pair, err := s.sessions.CreateTx(ctx, tx, a.ID, role, device)
	if err != nil {
		s.releaseReservation(ctx, reservationID)
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "session.login", a.ID, a.ID, "success", "", map[string]any{"role": role}); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
}

func (s *Service) recordPasswordFailure(ctx context.Context, phone, role, ipHash string, reservationID int64) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	for _, key := range []string{"identity:password-source:" + ipHash, "identity:password-subject:" + role + ":" + phone} {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key); err != nil {
			return false, err
		}
	}
	var accountFailures, sourceFailures int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_password_attempts WHERE phone_e164=$1 AND role=$2 AND succeeded=false AND (NOT reserved OR (reserved_until IS NOT NULL AND reserved_until > clock_timestamp())) AND created_at>clock_timestamp()-interval '15 minutes'", phone, role).Scan(&accountFailures); err != nil {
		return false, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_password_attempts WHERE ip_hash=$1 AND succeeded=false AND (NOT reserved OR (reserved_until IS NOT NULL AND reserved_until > clock_timestamp())) AND created_at>clock_timestamp()-interval '15 minutes'", ipHash).Scan(&sourceFailures); err != nil {
		return false, err
	}
	if reservationID > 0 {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_password_attempts SET reserved=false,reserved_until=NULL WHERE id=$1 AND succeeded=false", reservationID); err != nil {
			return false, err
		}
	} else if _, err := tx.ExecContext(ctx, "INSERT INTO identity_password_attempts(phone_e164,role,ip_hash,succeeded,reserved,reserved_until) VALUES($1,$2,$3,false,false,NULL)", phone, role, ipHash); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return sourceFailures >= passwordSourceFailureLimit, nil
}

func (s *Service) releaseReservation(ctx context.Context, reservationID int64) {
	if reservationID <= 0 {
		return
	}
	_, _ = s.db.ExecContext(ctx, "DELETE FROM identity_password_attempts WHERE id=$1 AND reserved=true", reservationID)
}

func (s *Service) passwordAdmission(ctx context.Context, phone, role, ipHash string) (bool, time.Duration, int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()
	for _, key := range []string{"identity:password-source:" + ipHash, "identity:password-subject:" + role + ":" + phone} {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key); err != nil {
			return false, 0, 0, err
		}
	}
	var accountFailures, sourceFailures int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_password_attempts WHERE phone_e164=$1 AND role=$2 AND succeeded=false AND (NOT reserved OR (reserved_until IS NOT NULL AND reserved_until > clock_timestamp())) AND created_at>clock_timestamp()-interval '15 minutes'", phone, role).Scan(&accountFailures); err != nil {
		return false, 0, 0, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_password_attempts WHERE ip_hash=$1 AND succeeded=false AND (NOT reserved OR (reserved_until IS NOT NULL AND reserved_until > clock_timestamp())) AND created_at>clock_timestamp()-interval '15 minutes'", ipHash).Scan(&sourceFailures); err != nil {
		return false, 0, 0, err
	}
	if sourceFailures >= passwordSourceFailureLimit {
		if err := tx.Commit(); err != nil {
			return false, 0, 0, err
		}
		return true, 0, 0, nil
	}
	var reservationID int64
	if err := tx.QueryRowContext(ctx, "INSERT INTO identity_password_attempts(phone_e164,role,ip_hash,succeeded,reserved,reserved_until) VALUES($1,$2,$3,false,true,clock_timestamp()+interval '30 seconds') RETURNING id", phone, role, ipHash).Scan(&reservationID); err != nil {
		return false, 0, 0, err
	}
	if err := tx.Commit(); err != nil {
		return false, 0, 0, err
	}
	backoff := time.Duration(0)
	if accountFailures >= passwordSubjectRiskThreshold {
		backoff = time.Duration(accountFailures-passwordSubjectRiskThreshold+1) * passwordBackoffStep
		if backoff > passwordBackoffMaximum {
			backoff = passwordBackoffMaximum
		}
	}
	return false, backoff, reservationID, nil
}

func (s *Service) recordPasswordSuccessTx(ctx context.Context, tx *sql.Tx, phone, role, ipHash string, reservationID int64) error {
	if reservationID > 0 {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_password_attempts SET succeeded=true,reserved=false,reserved_until=NULL WHERE id=$1 AND succeeded=false", reservationID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM identity_password_attempts WHERE phone_e164=$1 AND role=$2 AND succeeded=false AND reserved=false", phone, role); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO identity_password_attempts(phone_e164,role,ip_hash,succeeded,reserved,reserved_until) VALUES($1,$2,$3,true,false,NULL)", phone, role, ipHash)
	return err
}

func waitPasswordBackoff(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)", eventType, actorID, principal, outcome, correlationID, string(raw))
	return err
}
