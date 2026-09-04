package activation

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
	activationdelivery "github.com/bthwani2-boop/samrim/services/identity/backend/internal/integrations/activation"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
)

type Service struct {
	db       *sql.DB
	actors   *actor.Service
	sessions *session.Service
	secret   []byte
	sender   activationdelivery.Sender
	now      func() time.Time
}

func New(db *sql.DB, actors *actor.Service, sessions *session.Service, secret []byte, sender activationdelivery.Sender) *Service {
	return &Service{db: db, actors: actors, sessions: sessions, secret: secret, sender: sender, now: time.Now}
}

func (s *Service) Request(ctx context.Context, input domain.OtpRequest, ipHash string) (domain.ActivationChallenge, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsPublicOtpRole(role) {
		return domain.ActivationChallenge{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.ActivationChallenge{}, domain.ErrInvalidInput
	}
	ipHash = strings.TrimSpace(ipHash)
	if len(ipHash) != 64 {
		return domain.ActivationChallenge{}, domain.ErrInvalidInput
	}

	if role == "client" {
		return s.issue(ctx, domain.Actor{PhoneE164: phone}, role, ipHash)
	}

	a, err := s.actors.FindEnabledByPhoneRole(ctx, phone, role)
	if errors.Is(err, domain.ErrNotFound) || errors.Is(err, domain.ErrActorBlocked) {
		return s.genericChallenge(phone)
	}
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	return s.issue(ctx, a, role, ipHash)
}

func (s *Service) issue(ctx context.Context, a domain.Actor, role, ipHash string) (domain.ActivationChallenge, error) {
	surface, ok := domain.SurfaceForRole(role)
	if !ok {
		return domain.ActivationChallenge{}, domain.ErrInvalidActivation
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	defer func() { _ = tx.Rollback() }()

	for _, key := range []string{"identity:otp-source:" + ipHash, "identity:otp-phone:" + a.PhoneE164} {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key); err != nil {
			return domain.ActivationChallenge{}, err
		}
	}

	if role != "client" {
		var enabled bool
		if err := tx.QueryRowContext(ctx,
			"SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE",
			a.ID, role).Scan(&enabled); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return s.genericChallenge(a.PhoneE164)
			}
			return domain.ActivationChallenge{}, err
		} else if !enabled {
			return s.genericChallenge(a.PhoneE164)
		}
	}

	var phoneRecent, sourceRecent int
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM identity_activation_challenges WHERE phone_e164=$1 AND created_at>clock_timestamp()-interval '15 minutes'",
		a.PhoneE164).Scan(&phoneRecent); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM identity_activation_challenges WHERE request_ip_hash=$1 AND created_at>clock_timestamp()-interval '15 minutes'",
		ipHash).Scan(&sourceRecent); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if phoneRecent >= 5 || sourceRecent >= 20 {
		return domain.ActivationChallenge{}, domain.ErrRateLimited
	}

	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_activation_challenges SET status='revoked',updated_at=clock_timestamp() WHERE phone_e164=$1 AND role=$2 AND status='pending'",
		a.PhoneE164, role); err != nil {
		return domain.ActivationChallenge{}, err
	}

	activationID, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	code, err := s.codeFor(activationID)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	expires := s.now().UTC().Add(10 * time.Minute)
	codeHash := identitysecurity.HMAC256Hex(s.secret, activationID, code)
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO identity_activation_challenges(id,actor_id,role,phone_e164,code_hash,request_ip_hash,status,attempts,expires_at) VALUES($1,NULLIF($2,''),$3,$4,$5,$6,'pending',0,$7)",
		activationID, a.ID, role, a.PhoneE164, codeHash, ipHash, expires); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if err := auditTx(ctx, tx, "activation.issued", a.ID, a.ID, "success", "", map[string]any{"role": role}); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if err := s.sender.Send(ctx, activationdelivery.Message{
		Phone: a.PhoneE164, Code: code, ActorType: role, Surface: surface, ExpiresAt: expires,
	}); err != nil {
		return domain.ActivationChallenge{}, domain.ErrUnavailable
	}
	return domain.ActivationChallenge{ActivationID: activationID, MaskedPhone: identitysecurity.MaskPhone(a.PhoneE164), ExpiresAt: expires}, nil
}

func (s *Service) Consume(ctx context.Context, input domain.ActivationRequest) (domain.TokenPair, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.IsPublicOtpRole(role) {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.Phone)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	code, err := identitysecurity.NormalizeActivationCode(input.Code)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	if _, err := identitysecurity.NormalizeDeviceFingerprint(input.DeviceFingerprint); err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var challengeID, codeHash string
	var actorID sql.NullString
	var attempts int
	var expires time.Time
	err = tx.QueryRowContext(ctx,
		"SELECT id,actor_id,code_hash,attempts,expires_at FROM identity_activation_challenges WHERE role=$1 AND phone_e164=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
		role, phone).Scan(&challengeID, &actorID, &codeHash, &attempts, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !expires.After(s.now()) {
		if _, err := tx.ExecContext(ctx,
			"UPDATE identity_activation_challenges SET status='expired',updated_at=clock_timestamp() WHERE id=$1",
			challengeID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}

	expected := identitysecurity.HMAC256Hex(s.secret, challengeID, code)
	if !identitysecurity.ConstantTimeHexEqual(codeHash, expected) {
		attempts++
		nextStatus := "pending"
		if attempts >= 5 {
			nextStatus = "locked"
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE identity_activation_challenges SET attempts=$1,status=$2,updated_at=clock_timestamp() WHERE id=$3",
			attempts, nextStatus, challengeID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}

	resolvedActorID := ""
	if role == "client" {
		a, err := s.actors.EnsurePublicClientTx(ctx, tx, phone)
		if err != nil {
			return domain.TokenPair{}, err
		}
		resolvedActorID = a.ID
	} else {
		if !actorID.Valid || strings.TrimSpace(actorID.String) == "" {
			return domain.TokenPair{}, domain.ErrInvalidActivation
		}
		var enabled bool
		if err := tx.QueryRowContext(ctx,
			"SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE",
			actorID.String, role).Scan(&enabled); err != nil || !enabled {
			return domain.TokenPair{}, domain.ErrActorBlocked
		}
		resolvedActorID = actorID.String
	}

	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_activation_challenges SET status='consumed',consumed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
		challengeID); err != nil {
		return domain.TokenPair{}, err
	}
	pair, err := s.sessions.CreateForActivationTx(ctx, tx, resolvedActorID, role, input.DeviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "activation.consumed", resolvedActorID, resolvedActorID, "success", "", map[string]any{"role": role}); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
}

func (s *Service) genericChallenge(phone string) (domain.ActivationChallenge, error) {
	id, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	return domain.ActivationChallenge{
		ActivationID: id,
		MaskedPhone: identitysecurity.MaskPhone(phone),
		ExpiresAt: s.now().UTC().Add(10 * time.Minute),
	}, nil
}

func (s *Service) codeFor(activationID string) (string, error) {
	raw := identitysecurity.HMAC256Hex(s.secret, activationID, "activation-code")
	bytes, err := hex.DecodeString(raw[:8])
	if err != nil || len(bytes) != 4 {
		return "", domain.ErrUnavailable
	}
	value := (uint32(bytes[0])<<24 | uint32(bytes[1])<<16 | uint32(bytes[2])<<8 | uint32(bytes[3])) % 1000000
	return strconv.FormatUint(uint64(value)+1000000, 10)[1:], nil
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)",
		eventType, actorID, principal, outcome, correlationID, string(raw))
	return err
}
