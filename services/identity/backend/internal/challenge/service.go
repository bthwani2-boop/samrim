package challenge

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	challengedelivery "github.com/bthwani2-boop/samrim/services/identity/backend/internal/integrations/challenge"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
)

type Service struct {
	db       *sql.DB
	actors   *actor.Service
	sessions *session.Service
	secret   []byte
	sender   challengedelivery.Sender
	now      func() time.Time
}

const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$nl2x4UwETv8mM+eRDPVuvQ$C1rH4q7MVn4IuThQWK4cmDjPmF5HBNafRD7OMiZRpIY"

const (
	passwordSubjectRiskThreshold = 5
	passwordSourceFailureLimit   = 30
	challengePhoneFailureLimit   = 15
	challengeSourceFailureLimit  = 30
	challengeResendCooldown      = time.Minute
	passwordBackoffStep          = 250 * time.Millisecond
	passwordBackoffMaximum       = 2 * time.Second
)

func New(db *sql.DB, actors *actor.Service, sessions *session.Service, secret []byte, sender challengedelivery.Sender) *Service {
	return &Service{db: db, actors: actors, sessions: sessions, secret: secret, sender: sender, now: time.Now}
}

func (s *Service) RequestClientRegistration(ctx context.Context, input domain.PhoneRequest, ipHash string) (domain.Challenge, error) {
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	if len(ipHash) != 64 {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	var actorID string
	var securityEnabled bool
	var hasCredential, roleDisabled bool
	err = s.db.QueryRowContext(ctx, `SELECT id,security_enabled,
EXISTS(SELECT 1 FROM identity_password_credentials c WHERE c.actor_id=identity_actors.id AND c.role='client'),
EXISTS(SELECT 1 FROM identity_actor_roles r WHERE r.actor_id=identity_actors.id AND r.role='client' AND r.enabled=false)
FROM identity_actors WHERE phone_e164=$1`, phone).Scan(&actorID, &securityEnabled, &hasCredential, &roleDisabled)
	admissible := false
	if errors.Is(err, sql.ErrNoRows) {
		actorID = ""
		admissible = true
	} else if err != nil {
		return domain.Challenge{}, err
	} else {
		admissible = securityEnabled && !hasCredential && !roleDisabled
	}
	return s.issue(ctx, phone, "client", domain.ChallengeClientRegister, actorID, admissible, 0, ipHash)
}

func (s *Service) RegisterClient(ctx context.Context, input domain.ClientCredentialProofRequest) (domain.TokenPair, error) {
	return s.consume(ctx, input.Phone, "client", domain.ChallengeClientRegister, input.Code, func(tx *sql.Tx, _ string) (domain.TokenPair, error) {
		a, err := s.actors.RegisterClientTx(ctx, tx, input.Phone, input.Password)
		if errors.Is(err, domain.ErrActorBlocked) || errors.Is(err, domain.ErrConflict) {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		if err != nil {
			return domain.TokenPair{}, err
		}
		return s.sessions.CreateTx(ctx, tx, a.ID, "client", input.DeviceFingerprint)
	})
}

func (s *Service) LoginClient(ctx context.Context, input domain.PasswordLoginRequest, ipHash string) (domain.TokenPair, error) {
	return s.loginPassword(ctx, input.Phone, input.Password, "client", input.DeviceFingerprint, ipHash)
}

func (s *Service) LoginManaged(ctx context.Context, input domain.ManagedPasswordLoginRequest, ipHash string) (domain.TokenPair, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsManagedRole(role) {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	return s.loginPassword(ctx, input.Phone, input.Password, role, input.DeviceFingerprint, ipHash)
}

func (s *Service) loginPassword(ctx context.Context, rawPhone, password, role, rawDevice, ipHash string) (domain.TokenPair, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	device, err := identitysecurity.NormalizeDeviceFingerprint(rawDevice)
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
		_ = tx.Rollback()
		s.releaseReservation(ctx, reservationID)
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	if err := s.recordPasswordSuccessTx(ctx, tx, phone, role, ipHash, reservationID); err != nil {
		s.releaseReservation(ctx, reservationID)
		return domain.TokenPair{}, err
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

func (s *Service) RequestClientRecovery(ctx context.Context, input domain.PhoneRequest, ipHash string) (domain.Challenge, error) {
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	a, _, _, lookupErr := s.actors.PasswordCredential(ctx, phone, "client")
	admissible := lookupErr == nil
	actorID := ""
	if admissible {
		actorID = a.ID
	} else if lookupErr != nil && !errors.Is(lookupErr, domain.ErrNotFound) {
		return domain.Challenge{}, lookupErr
	}
	return s.issue(ctx, phone, "client", domain.ChallengeClientRecover, actorID, admissible, 0, ipHash)
}

func (s *Service) RecoverClient(ctx context.Context, input domain.ClientCredentialProofRequest) (domain.TokenPair, error) {
	return s.consume(ctx, input.Phone, "client", domain.ChallengeClientRecover, input.Code, func(tx *sql.Tx, actorID string) (domain.TokenPair, error) {
		if actorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		if err := s.actors.ResetClientPasswordTx(ctx, tx, actorID, input.Password); err != nil {
			return domain.TokenPair{}, err
		}
		return s.sessions.CreateTx(ctx, tx, actorID, "client", input.DeviceFingerprint)
	})
}

func (s *Service) RequestManagedRecovery(ctx context.Context, input domain.ManagedRecoveryChallengeRequest, ipHash string) (domain.Challenge, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsManagedActivationRole(role) {
		return domain.Challenge{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	a, roleView, lookupErr := s.actors.ManagedActivationCandidate(ctx, phone, role)
	admissible := false
	actorID := ""
	if lookupErr == nil && roleView.ActivatedAt != nil {
		if _, _, _, credentialErr := s.actors.PasswordCredential(ctx, phone, role); credentialErr == nil {
			admissible = true
			actorID = a.ID
		} else if !errors.Is(credentialErr, domain.ErrNotFound) {
			return domain.Challenge{}, credentialErr
		}
	} else if lookupErr != nil && !errors.Is(lookupErr, domain.ErrNotFound) && !errors.Is(lookupErr, domain.ErrActorBlocked) {
		return domain.Challenge{}, lookupErr
	}
	return s.issue(ctx, phone, role, domain.ChallengeManagedRecover, actorID, admissible, 0, ipHash)
}

func (s *Service) RecoverManaged(ctx context.Context, input domain.ManagedRecoveryRequest) (domain.RecoveryResult, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsManagedActivationRole(role) {
		return domain.RecoveryResult{}, domain.ErrInvalidInput
	}
	_, err := s.consume(ctx, input.Phone, role, domain.ChallengeManagedRecover, input.Code, func(tx *sql.Tx, actorID string) (domain.TokenPair, error) {
		if actorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		if err := s.actors.ResetManagedPasswordTx(ctx, tx, actorID, role, input.Password); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{Identity: domain.ActorIdentity{Subject: actorID}}, nil
	})
	if err != nil {
		return domain.RecoveryResult{}, err
	}
	return domain.RecoveryResult{Status: "recovery_complete"}, nil
}

func (s *Service) RequestManagedActivation(ctx context.Context, input domain.ManagedChallengeRequest, ipHash string) (domain.Challenge, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsManagedActivationRole(role) {
		return domain.Challenge{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	if domain.RequiresEnrollmentToken(role) {
		if err := s.validateEnrollmentToken(ctx, phone, role, input.ActivationCode); err != nil {
			return domain.Challenge{}, err
		}
	}
	a, r, lookupErr := s.actors.ManagedActivationCandidate(ctx, phone, role)
	admissible := lookupErr == nil && r.ActivatedAt == nil
	actorID := ""
	if admissible {
		actorID = a.ID
	} else if lookupErr != nil && !errors.Is(lookupErr, domain.ErrNotFound) && !errors.Is(lookupErr, domain.ErrActorBlocked) {
		return domain.Challenge{}, lookupErr
	}
	return s.issue(ctx, phone, role, domain.ChallengeManagedActivate, actorID, admissible, 0, ipHash)
}

func (s *Service) ActivateManaged(ctx context.Context, input domain.ManagedActivationRequest) (domain.TokenPair, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsManagedActivationRole(role) {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	return s.consume(ctx, input.Phone, role, domain.ChallengeManagedActivate, input.VerificationCode, func(tx *sql.Tx, actorID string) (domain.TokenPair, error) {
		if actorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidActivation
		}
		if domain.RequiresEnrollmentToken(role) {
			if _, err := s.consumeOperatorEnrollmentTokenTx(ctx, tx, input.Phone, role, input.ActivationCode, actorID); err != nil {
				return domain.TokenPair{}, err
			}
		}
		if err := s.actors.MarkManagedActivatedTx(ctx, tx, actorID, role); err != nil {
			return domain.TokenPair{}, err
		}
		if err := s.actors.SetManagedPasswordTx(ctx, tx, actorID, role, input.Password); err != nil {
			return domain.TokenPair{}, err
		}
		return s.sessions.CreateTx(ctx, tx, actorID, role, input.DeviceFingerprint)
	})
}

func (s *Service) IssueOperatorEnrollmentToken(ctx context.Context, input domain.OperatorEnrollmentTokenIssueRequest, caller string) (domain.OperatorEnrollmentToken, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.CanIssueOperatorEnrollmentTokenForRole(caller, role) {
		return domain.OperatorEnrollmentToken{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.PhoneE164)
	if err != nil {
		return domain.OperatorEnrollmentToken{}, domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:managed-code:"+role+":"+phone); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	var actorID string
	var enabled, securityEnabled bool
	var activated sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT a.id,r.enabled,a.security_enabled,r.activated_at
FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id
WHERE a.phone_e164=$1 AND r.role=$2 FOR UPDATE OF a,r`, phone, role).Scan(&actorID, &enabled, &securityEnabled, &activated)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.OperatorEnrollmentToken{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	if !enabled || !securityEnabled {
		return domain.OperatorEnrollmentToken{}, domain.ErrForbidden
	}
	if activated.Valid {
		return domain.OperatorEnrollmentToken{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND purpose=$3 AND status='pending'", actorID, role, domain.ChallengeManagedActivate); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	id, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	rawCode, err := identitysecurity.RandomEnrollmentToken()
	if err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	normalizedCode, err := identitysecurity.NormalizeEnrollmentToken(rawCode)
	if err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	expires := s.now().UTC().Add(48 * time.Hour)
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_operator_enrollment_tokens(id,actor_id,role,phone_e164,code_hash,status,attempts,expires_at,created_by) VALUES($1,$2,$3,$4,$5,'pending',0,$6,$7)`, id, actorID, role, phone, identitysecurity.SHA256Hex(normalizedCode), expires, strings.ToLower(strings.TrimSpace(caller))); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	if err := auditTx(ctx, tx, "operator_enrollment_token.issued", actorID, caller, "success", "", map[string]any{"role": role, "expiresAt": expires.UTC().Format(time.RFC3339)}); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	return domain.OperatorEnrollmentToken{Code: rawCode, MaskedPhone: identitysecurity.MaskPhone(phone), Role: role, ExpiresAt: expires}, nil
}

func (s *Service) validateEnrollmentToken(ctx context.Context, phone, role, rawCode string) error {
	code, err := identitysecurity.NormalizeEnrollmentToken(rawCode)
	if err != nil {
		return domain.ErrInvalidActivation
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:managed-code:"+role+":"+phone); err != nil {
		return err
	}
	_, err = s.consumeOperatorEnrollmentTokenTx(ctx, tx, phone, role, code, "")
	if err != nil {
		if errors.Is(err, domain.ErrInvalidActivation) {
			_ = tx.Commit()
		}
		return err
	}
	return tx.Commit()
}

func (s *Service) consumeOperatorEnrollmentTokenTx(ctx context.Context, tx *sql.Tx, phone, role, rawCode, expectedActorID string) (string, error) {
	phone, err := identitysecurity.NormalizePhoneE164(phone)
	if err != nil {
		return "", domain.ErrInvalidActivation
	}
	code, err := identitysecurity.NormalizeEnrollmentToken(rawCode)
	if err != nil {
		return "", domain.ErrInvalidActivation
	}
	var id, actorID, codeHash string
	var attempts int
	var expires time.Time
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,code_hash,attempts,expires_at FROM identity_operator_enrollment_tokens WHERE phone_e164=$1 AND role=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, phone, role).Scan(&id, &actorID, &codeHash, &attempts, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", domain.ErrInvalidActivation
	}
	if err != nil {
		return "", err
	}
	if !expires.After(s.now()) {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='expired',updated_at=clock_timestamp() WHERE id=$1", id); err != nil {
			return "", err
		}
		return "", domain.ErrInvalidActivation
	}
	if expectedActorID != "" && actorID != expectedActorID {
		return "", domain.ErrInvalidActivation
	}
	if !identitysecurity.ConstantTimeHexEqual(codeHash, identitysecurity.SHA256Hex(code)) {
		attempts++
		nextStatus := "pending"
		if attempts >= 5 {
			nextStatus = "locked"
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET attempts=$1,status=$2,updated_at=clock_timestamp() WHERE id=$3", attempts, nextStatus, id); err != nil {
			return "", err
		}
		return "", domain.ErrInvalidActivation
	}
	if expectedActorID != "" {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='consumed',consumed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", id); err != nil {
			return "", err
		}
	}
	return actorID, nil
}

func (s *Service) StartOperatorLogin(ctx context.Context, input domain.OperatorLoginStartRequest, ipHash string) (domain.Challenge, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsControlPanelRole(role) {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	limited, backoff, reservationID, err := s.passwordAdmission(ctx, phone, role, ipHash)
	if err != nil {
		return domain.Challenge{}, err
	}
	if limited {
		return domain.Challenge{}, domain.ErrRateLimited
	}
	if err := waitPasswordBackoff(ctx, backoff); err != nil {
		return domain.Challenge{}, err
	}
	a, hash, credentialVersion, lookupErr := s.actors.PasswordCredential(ctx, phone, role)
	valid := lookupErr == nil && identitysecurity.VerifyPassword(hash, input.Password)
	if errors.Is(lookupErr, domain.ErrNotFound) {
		_ = identitysecurity.VerifyPassword(dummyPasswordHash, input.Password)
	} else if lookupErr != nil {
		s.releaseReservation(ctx, reservationID)
		return domain.Challenge{}, lookupErr
	}
	if !valid {
		limited, recordErr := s.recordPasswordFailure(ctx, phone, role, ipHash, reservationID)
		if recordErr != nil {
			return domain.Challenge{}, recordErr
		}
		if limited {
			return domain.Challenge{}, domain.ErrRateLimited
		}
		return s.issue(ctx, phone, role, domain.ChallengeOperatorMFA, "", false, 0, ipHash)
	}
	if err := s.recordPasswordSuccess(ctx, phone, role, ipHash, reservationID); err != nil {
		return domain.Challenge{}, err
	}
	return s.issue(ctx, phone, role, domain.ChallengeOperatorMFA, a.ID, true, credentialVersion, ipHash)
}

func (s *Service) CompleteOperatorLogin(ctx context.Context, input domain.OperatorLoginCompleteRequest) (domain.TokenPair, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsControlPanelRole(role) {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	return s.consume(ctx, input.Phone, role, domain.ChallengeOperatorMFA, input.Code, func(tx *sql.Tx, actorID string) (domain.TokenPair, error) {
		if actorID == "" {
			return domain.TokenPair{}, domain.ErrUnauthenticated
		}
		return s.sessions.CreateTx(ctx, tx, actorID, role, input.DeviceFingerprint)
	})
}

func (s *Service) issue(ctx context.Context, phone, role, purpose, actorID string, admissible bool, expectedCredentialVersion int, ipHash string) (domain.Challenge, error) {
	ipHash = strings.TrimSpace(ipHash)
	if len(ipHash) != 64 {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	_, ok := domain.SurfaceForRole(role)
	if !ok {
		return domain.Challenge{}, domain.ErrInvalidChallenge
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Challenge{}, err
	}
	defer func() { _ = tx.Rollback() }()
	for _, key := range []string{"identity:challenge-source:" + ipHash, "identity:challenge-phone:" + phone} {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key); err != nil {
			return domain.Challenge{}, err
		}
	}
	var existingID string
	var existingExpiry, existingCreated time.Time
	var existingAdmissible bool
	var existingActorID sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,expires_at,created_at,admissible,actor_id
FROM identity_challenges
WHERE phone_e164=$1 AND role=$2 AND purpose=$3 AND status='pending'
	ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, phone, role, purpose).Scan(&existingID, &existingExpiry, &existingCreated, &existingAdmissible, &existingActorID)
	existingActor := ""
	if existingActorID.Valid {
		existingActor = existingActorID.String
	}
	if err == nil && s.now().UTC().Sub(existingCreated) < challengeResendCooldown && existingAdmissible == admissible && existingActor == actorID {
		if err := tx.Commit(); err != nil {
			return domain.Challenge{}, err
		}
		return domain.Challenge{ChallengeID: existingID, MaskedPhone: identitysecurity.MaskPhone(phone), ExpiresAt: existingExpiry}, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.Challenge{}, err
	}
	if purpose == domain.ChallengeOperatorMFA && admissible {
		var currentVersion int
		var enabled, securityEnabled bool
		err := tx.QueryRowContext(ctx, `SELECT c.version,r.enabled,a.security_enabled
FROM identity_password_credentials c
JOIN identity_actor_roles r ON r.actor_id=c.actor_id AND r.role=c.role
JOIN identity_actors a ON a.id=c.actor_id
WHERE c.actor_id=$1 AND c.role=$3 AND a.phone_e164=$2
		FOR UPDATE OF c,r,a`, actorID, phone, role).Scan(&currentVersion, &enabled, &securityEnabled)
		if errors.Is(err, sql.ErrNoRows) || !enabled || !securityEnabled || currentVersion != expectedCredentialVersion {
			admissible = false
			actorID = ""
		} else if err != nil {
			return domain.Challenge{}, err
		}
	}
	var phoneRecent, sourceRecent int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_challenges WHERE phone_e164=$1 AND purpose=$2 AND created_at>clock_timestamp()-interval '15 minutes'", phone, purpose).Scan(&phoneRecent); err != nil {
		return domain.Challenge{}, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_challenges WHERE request_ip_hash=$1 AND created_at>clock_timestamp()-interval '15 minutes'", ipHash).Scan(&sourceRecent); err != nil {
		return domain.Challenge{}, err
	}
	var phoneFailures, sourceFailures int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(attempts),0) FROM identity_challenges WHERE phone_e164=$1 AND role=$2 AND purpose=$3 AND created_at>clock_timestamp()-interval '15 minutes'", phone, role, purpose).Scan(&phoneFailures); err != nil {
		return domain.Challenge{}, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(attempts),0) FROM identity_challenges WHERE request_ip_hash=$1 AND created_at>clock_timestamp()-interval '15 minutes'", ipHash).Scan(&sourceFailures); err != nil {
		return domain.Challenge{}, err
	}
	if phoneRecent >= 5 || sourceRecent >= 20 || phoneFailures >= challengePhoneFailureLimit || sourceFailures >= challengeSourceFailureLimit {
		return domain.Challenge{}, domain.ErrRateLimited
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE phone_e164=$1 AND role=$2 AND purpose=$3 AND status='pending'", phone, role, purpose); err != nil {
		return domain.Challenge{}, err
	}
	challengeID, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.Challenge{}, err
	}
	code, err := s.codeFor(challengeID, purpose)
	if err != nil {
		return domain.Challenge{}, err
	}
	expires := s.now().UTC().Add(10 * time.Minute)
	codeHash := identitysecurity.HMAC256Hex(s.secret, challengeID, purpose, code)
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_challenges(id,actor_id,role,purpose,phone_e164,code_hash,request_ip_hash,admissible,credential_version,status,attempts,expires_at) VALUES($1,NULLIF($2,''),$3,$4,$5,$6,$7,$8,NULLIF($9,0),'pending',0,$10)", challengeID, actorID, role, purpose, phone, codeHash, ipHash, admissible, expectedCredentialVersion, expires); err != nil {
		return domain.Challenge{}, err
	}
	deliveryStatus := "suppressed"
	if admissible {
		deliveryStatus = "pending"
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_challenge_deliveries(challenge_id,provider,status) VALUES($1,$2,$3)", challengeID, s.sender.Provider(), deliveryStatus); err != nil {
		return domain.Challenge{}, err
	}
	eventType := "challenge.issued"
	if !admissible {
		eventType = "challenge.decoy_issued"
	}
	principal := actorID
	if principal == "" {
		principal = "public-challenge"
	}
	if err := auditTx(ctx, tx, eventType, actorID, principal, "success", "", map[string]any{"role": role, "purpose": purpose, "deliveryProvider": s.sender.Provider(), "deliveryStatus": deliveryStatus}); err != nil {
		return domain.Challenge{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Challenge{}, err
	}
	return domain.Challenge{ChallengeID: challengeID, MaskedPhone: identitysecurity.MaskPhone(phone), ExpiresAt: expires}, nil
}

type consumeAction func(*sql.Tx, string) (domain.TokenPair, error)

func (s *Service) consume(ctx context.Context, rawPhone, role, purpose, rawCode string, action consumeAction) (domain.TokenPair, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	code, err := identitysecurity.NormalizeVerificationCode(rawCode)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:challenge-phone:"+phone); err != nil {
		return domain.TokenPair{}, err
	}
	var challengeID, codeHash string
	var actorID sql.NullString
	var attempts int
	var expires time.Time
	var admissible bool
	var credentialVersion sql.NullInt64
	err = tx.QueryRowContext(ctx, "SELECT id,actor_id,code_hash,attempts,expires_at,admissible,credential_version FROM identity_challenges WHERE purpose=$1 AND role=$2 AND phone_e164=$3 AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", purpose, role, phone).Scan(&challengeID, &actorID, &codeHash, &attempts, &expires, &admissible, &credentialVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !expires.After(s.now()) {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='expired',updated_at=clock_timestamp() WHERE id=$1", challengeID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	expected := identitysecurity.HMAC256Hex(s.secret, challengeID, purpose, code)
	if !identitysecurity.ConstantTimeHexEqual(codeHash, expected) {
		attempts++
		nextStatus := "pending"
		if attempts >= 5 {
			nextStatus = "locked"
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET attempts=$1,status=$2,updated_at=clock_timestamp() WHERE id=$3", attempts, nextStatus, challengeID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	if !admissible {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='consumed',consumed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", challengeID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidChallenge
	}
	resolvedActorID := ""
	if actorID.Valid {
		resolvedActorID = actorID.String
	}
	if purpose == domain.ChallengeOperatorMFA {
		var currentVersion int
		err := tx.QueryRowContext(ctx, `SELECT c.version
FROM identity_password_credentials c
JOIN identity_actor_roles r ON r.actor_id=c.actor_id AND r.role=c.role
JOIN identity_actors a ON a.id=c.actor_id
WHERE c.actor_id=$1 AND c.role=$2 AND a.phone_e164=$3 AND r.enabled=true AND a.security_enabled=true
FOR UPDATE OF c,r,a`, resolvedActorID, role, phone).Scan(&currentVersion)
		if err != nil || !credentialVersion.Valid || int(credentialVersion.Int64) != currentVersion {
			if _, updateErr := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE id=$1", challengeID); updateErr != nil {
				return domain.TokenPair{}, updateErr
			}
			if commitErr := tx.Commit(); commitErr != nil {
				return domain.TokenPair{}, commitErr
			}
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
	}
	pair, err := action(tx, resolvedActorID)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET actor_id=COALESCE(NULLIF($1,''),actor_id),status='consumed',consumed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$2", pair.Identity.Subject, challengeID); err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "challenge.consumed", pair.Identity.Subject, pair.Identity.Subject, "success", "", map[string]any{"role": role, "purpose": purpose}); err != nil {
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

func (s *Service) recordPasswordSuccess(ctx context.Context, phone, role, ipHash string, reservationID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.recordPasswordSuccessTx(ctx, tx, phone, role, ipHash, reservationID); err != nil {
		return err
	}
	return tx.Commit()
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

func (s *Service) codeFor(challengeID, purpose string) (string, error) {
	raw := identitysecurity.HMAC256Hex(s.secret, challengeID, purpose, "challenge-code")
	bytes, err := hex.DecodeString(raw[:8])
	if err != nil || len(bytes) != 4 {
		return "", domain.ErrUnavailable
	}
	value := strconv.FormatUint(uint64((uint32(bytes[0])<<24|uint32(bytes[1])<<16|uint32(bytes[2])<<8|uint32(bytes[3]))%1_000_000), 10)
	return strings.Repeat("0", 6-len(value)) + value, nil
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
