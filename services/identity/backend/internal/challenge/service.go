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

type ProviderBudgetConfig struct {
	MaxPerMinute int
	MaxPerHour   int
}

func DefaultProviderBudgetConfig() ProviderBudgetConfig {
	return ProviderBudgetConfig{
		MaxPerMinute: 60,
		MaxPerHour:   500,
	}
}

type Service struct {
	db       *sql.DB
	actors   *actor.Service
	sessions *session.Service
	secret   []byte
	sender   challengedelivery.Sender
	budget   ProviderBudgetConfig
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

func New(db *sql.DB, actors *actor.Service, sessions *session.Service, secret []byte, sender challengedelivery.Sender, budget ...ProviderBudgetConfig) *Service {
	b := DefaultProviderBudgetConfig()
	if len(budget) > 0 {
		if budget[0].MaxPerMinute > 0 {
			b.MaxPerMinute = budget[0].MaxPerMinute
		}
		if budget[0].MaxPerHour > 0 {
			b.MaxPerHour = budget[0].MaxPerHour
		}
	}
	return &Service{db: db, actors: actors, sessions: sessions, secret: secret, sender: sender, budget: b, now: time.Now}
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
		return s.sessions.CreateTx(ctx, tx, a.ID, "client", input.ClientInstanceId)
	})
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
		_ = tx.Rollback()
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

func (s *Service) RecoverClient(ctx context.Context, input domain.ClientRecoveryProofRequest) (domain.RecoveryResult, error) {
	_, err := s.consume(ctx, input.Phone, "client", domain.ChallengeClientRecover, input.Code, func(tx *sql.Tx, actorID string) (domain.TokenPair, error) {
		if actorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		if err := s.actors.ResetClientPasswordTx(ctx, tx, actorID, input.Password); err != nil {
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
	if !domain.IsManagedRole(role) {
		return domain.Challenge{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
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
	if !domain.IsManagedRole(role) {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	return s.consume(ctx, input.Phone, role, domain.ChallengeManagedActivate, input.VerificationCode, func(tx *sql.Tx, actorID string) (domain.TokenPair, error) {
		if actorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidActivation
		}
		if err := s.actors.MarkManagedActivatedTx(ctx, tx, actorID, role); err != nil {
			return domain.TokenPair{}, err
		}
		if err := s.actors.SetManagedPasswordTx(ctx, tx, actorID, role, input.Password); err != nil {
			return domain.TokenPair{}, err
		}
		return s.sessions.CreateTx(ctx, tx, actorID, role, input.ClientInstanceId)
	})
}

func (s *Service) RequestOperatorEnrollment(ctx context.Context, input domain.OperatorEnrollmentRequest, ipHash string) (domain.Challenge, error) {
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	if err := s.validateEnrollmentToken(ctx, phone, "operator", input.OperatorEnrollmentToken); err != nil {
		return domain.Challenge{}, err
	}
	var actorID string
	var enabled, securityEnabled bool
	err = s.db.QueryRowContext(ctx, `SELECT a.id,r.enabled,a.security_enabled
FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator'
WHERE a.phone_e164=$1`, phone).Scan(&actorID, &enabled, &securityEnabled)
	admissible := err == nil && enabled && securityEnabled
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.Challenge{}, err
	}
	if !admissible {
		actorID = ""
	}
	return s.issue(ctx, phone, "operator", domain.ChallengeOperatorEnroll, actorID, admissible, 0, ipHash)
}

func (s *Service) RequestOperatorRecovery(ctx context.Context, input domain.OperatorRecoveryRequest, ipHash string) (domain.Challenge, error) {
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	recoveryCredential, err := identitysecurity.NormalizeRecoveryCredential(input.RecoveryCredential)
	if err != nil {
		return domain.Challenge{}, domain.ErrInvalidInput
	}
	var actorID string
	var enabled, securityEnabled, credentialValid bool
	err = s.db.QueryRowContext(ctx, `SELECT a.id,r.enabled,a.security_enabled,EXISTS(
SELECT 1 FROM identity_operator_recovery_credentials c
WHERE c.actor_id=a.id AND c.credential_hash=$2 AND c.used_at IS NULL AND c.revoked_at IS NULL)
FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator'
WHERE a.phone_e164=$1`, phone, identitysecurity.SHA256Hex(recoveryCredential)).Scan(&actorID, &enabled, &securityEnabled, &credentialValid)
	admissible := err == nil && enabled && securityEnabled && credentialValid
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.Challenge{}, err
	}
	if !admissible {
		actorID = ""
	}
	return s.issue(ctx, phone, "operator", domain.ChallengeOperatorRecover, actorID, admissible, 0, ipHash)
}

func (s *Service) ConsumeOperatorRecoveryPhoneProof(ctx context.Context, input domain.OperatorPasskeyRecoveryRegistrationOptionsRequest) (string, error) {
	recoveryCredential, err := identitysecurity.NormalizeRecoveryCredential(input.RecoveryCredential)
	if err != nil {
		return "", domain.ErrInvalidChallenge
	}
	var actorID string
	_, err = s.consume(ctx, input.Phone, "operator", domain.ChallengeOperatorRecover, input.VerificationCode, func(tx *sql.Tx, challengeActorID string) (domain.TokenPair, error) {
		if challengeActorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		var credentialID string
		if err := tx.QueryRowContext(ctx, `SELECT id FROM identity_operator_recovery_credentials WHERE actor_id=$1 AND credential_hash=$2 AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE`, challengeActorID, identitysecurity.SHA256Hex(recoveryCredential)).Scan(&credentialID); errors.Is(err, sql.ErrNoRows) {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		} else if err != nil {
			return domain.TokenPair{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_recovery_credentials SET used_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE id=$1", credentialID); err != nil {
			return domain.TokenPair{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL", challengeActorID); err != nil {
			return domain.TokenPair{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_webauthn_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE actor_id=$1 AND revoked_at IS NULL", challengeActorID); err != nil {
			return domain.TokenPair{}, err
		}
		actorID = challengeActorID
		return domain.TokenPair{Identity: domain.ActorIdentity{Subject: challengeActorID}}, nil
	})
	if err != nil {
		return "", err
	}
	return actorID, nil
}

func (s *Service) ConsumeOperatorEnrollmentPhoneProof(ctx context.Context, input domain.OperatorPasskeyRegistrationOptionsRequest) (string, error) {
	var actorID string
	_, err := s.consume(ctx, input.Phone, "operator", domain.ChallengeOperatorEnroll, input.VerificationCode, func(tx *sql.Tx, challengeActorID string) (domain.TokenPair, error) {
		if challengeActorID == "" {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		resolved, tokenErr := s.consumeOperatorEnrollmentTokenTx(ctx, tx, input.Phone, "operator", input.OperatorEnrollmentToken, challengeActorID)
		if tokenErr != nil || resolved != challengeActorID {
			return domain.TokenPair{}, domain.ErrInvalidChallenge
		}
		actorID = challengeActorID
		return domain.TokenPair{Identity: domain.ActorIdentity{Subject: challengeActorID}}, nil
	})
	if err != nil {
		return "", err
	}
	return actorID, nil
}

func (s *Service) IssueOperatorEnrollmentToken(ctx context.Context, input domain.OperatorEnrollmentTokenIssueRequest, caller, actingActorID string) (domain.OperatorEnrollmentToken, error) {
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
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:operator-enrollment-token:"+role+":"+phone); err != nil {
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
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL", actorID); err != nil {
			return domain.OperatorEnrollmentToken{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_webauthn_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE actor_id=$1 AND rp_id IS NOT NULL AND revoked_at IS NULL", actorID); err != nil {
			return domain.OperatorEnrollmentToken{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_recovery_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE actor_id=$1 AND revoked_at IS NULL", actorID); err != nil {
			return domain.OperatorEnrollmentToken{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_actor_roles SET activated_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND role='operator'", actorID); err != nil {
			return domain.OperatorEnrollmentToken{}, err
		}
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
	createdBy := strings.ToLower(strings.TrimSpace(caller))
	if strings.TrimSpace(actingActorID) != "" {
		createdBy = strings.TrimSpace(actingActorID)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_operator_enrollment_tokens(id,actor_id,role,phone_e164,code_hash,status,attempts,expires_at,created_by) VALUES($1,$2,$3,$4,$5,'pending',0,$6,$7)`, id, actorID, role, phone, identitysecurity.SHA256Hex(normalizedCode), expires, createdBy); err != nil {
		return domain.OperatorEnrollmentToken{}, err
	}
	auditPrincipal := caller
	meta := map[string]any{"role": role, "expiresAt": expires.UTC().Format(time.RFC3339), "workload": caller}
	if strings.TrimSpace(actingActorID) != "" {
		auditPrincipal = caller + ":" + strings.TrimSpace(actingActorID)
		meta["actingActorId"] = strings.TrimSpace(actingActorID)
	}
	if err := auditTx(ctx, tx, "operator_enrollment_token.issued", actorID, auditPrincipal, "success", "", meta); err != nil {
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
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:operator-enrollment-token:"+role+":"+phone); err != nil {
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
	err = tx.QueryRowContext(ctx, "SELECT id,actor_id,code_hash,attempts,expires_at,admissible FROM identity_challenges WHERE purpose=$1 AND role=$2 AND phone_e164=$3 AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", purpose, role, phone).Scan(&challengeID, &actorID, &codeHash, &attempts, &expires, &admissible)
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
