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
	"github.com/lib/pq"
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
	return &Service{db:db,actors:actors,sessions:sessions,secret:secret,sender:sender,now:time.Now}
}

func (s *Service) RequestPublicClient(ctx context.Context, operatorContextID string, input domain.OtpRequest) (domain.ActivationChallenge, error) {
	if strings.ToLower(strings.TrimSpace(input.ActorType)) != "client" {
		return domain.ActivationChallenge{}, domain.ErrForbidden
	}
	a, err := s.actors.EnsurePublicClient(ctx, operatorContextID, input.Phone)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	return s.issue(ctx, a, "client", "public-client", "", "", true)
}

func (s *Service) IssueForActor(ctx context.Context, caller, operatorContextID, actorID string, input domain.IssueActivationInput, idempotencyKey, correlationID string) (domain.ActivationChallenge, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	operatorContextID = strings.TrimSpace(operatorContextID)
	actorID = strings.TrimSpace(actorID)
	role := strings.ToLower(strings.TrimSpace(input.ExpectedActorType))
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if caller == "" || operatorContextID == "" || actorID == "" || idempotencyKey == "" || len(idempotencyKey) > 128 {
		return domain.ActivationChallenge{}, domain.ErrInvalidInput
	}
	if !domain.RoleAllowedForCaller(caller, role) {
		return domain.ActivationChallenge{}, domain.ErrForbidden
	}
	a, err := actorByIDScoped(ctx, s.db, operatorContextID, actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActivationChallenge{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	if !domain.ActorHasRole(a, role) {
		return domain.ActivationChallenge{}, domain.ErrConflict
	}
	return s.issue(ctx, a, role, caller, idempotencyKey, correlationID, false)
}

func (s *Service) issue(ctx context.Context, a domain.Actor, role, principal, idempotencyKey, correlationID string, public bool) (domain.ActivationChallenge, error) {
	surface, ok := domain.SurfaceForRole(role)
	if !ok || !domain.ActorHasRole(a, role) {
		return domain.ActivationChallenge{}, domain.ErrInvalidActivation
	}
	if a.Status == domain.ActorStatusSuspended || a.Status == domain.ActorStatusDeactivated {
		return domain.ActivationChallenge{}, domain.ErrActorBlocked
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	defer func(){ _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "SELECT id FROM identity_actors WHERE id=$1 FOR UPDATE", a.ID); err != nil {
		return domain.ActivationChallenge{}, err
	}
	var recent int
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM identity_activation_challenges WHERE phone_e164=$1 AND created_at>clock_timestamp()-interval '15 minutes'",
		a.PhoneE164).Scan(&recent); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if recent >= 5 {
		return domain.ActivationChallenge{}, domain.ErrRateLimited
	}

	scope := ""
	if !public {
		scope = principal + "|" + a.OperatorContextID + "|" + a.ID + "|" + surface
		var existingID, existingStatus string
		var expires time.Time
		err := tx.QueryRowContext(ctx,
			"SELECT id,status,expires_at FROM identity_activation_challenges WHERE idempotency_scope=$1 AND idempotency_key=$2",
			scope, idempotencyKey).Scan(&existingID, &existingStatus, &expires)
		if err == nil {
			if existingStatus != "pending" || !expires.After(s.now()) {
				return domain.ActivationChallenge{}, domain.ErrConflict
			}
			if err := tx.Commit(); err != nil {
				return domain.ActivationChallenge{}, err
			}
			challenge := domain.ActivationChallenge{ActivationID:existingID,MaskedPhone:identitysecurity.MaskPhone(a.PhoneE164),ExpiresAt:expires}
			if err := s.deliver(ctx, existingID, a, role, surface, expires); err != nil {
				return domain.ActivationChallenge{}, domain.ErrUnavailable
			}
			return challenge, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return domain.ActivationChallenge{}, err
		}
	}

	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_activation_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND surface=$2 AND status='pending'",
		a.ID, surface); err != nil {
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
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_activation_challenges(id,actor_id,actor_type,phone_e164,surface,code_hash,status,attempts,expires_at,issued_by,idempotency_scope,idempotency_key,correlation_id) VALUES($1,$2,$3,$4,$5,$6,'pending',0,$7,$8,NULLIF($9,''),NULLIF($10,''),NULLIF($11,''))",
		activationID, a.ID, role, a.PhoneE164, surface, codeHash, expires, principal, scope, idempotencyKey, correlationID)
	if err != nil {
		return domain.ActivationChallenge{}, err
	}
	if a.Status != domain.ActorStatusActive {
		if _, err := tx.ExecContext(ctx,
			"UPDATE identity_actors SET status='PENDING_ACTIVATION',version=version+1,updated_at=clock_timestamp() WHERE id=$1", a.ID); err != nil {
			return domain.ActivationChallenge{}, err
		}
	}
	if err := auditTx(ctx, tx, "activation.issued", a.ID, principal, "success", correlationID, map[string]any{"surface":surface}); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ActivationChallenge{}, err
	}
	if err := s.sender.Send(ctx, activationdelivery.Message{Phone:a.PhoneE164,Code:code,ActorType:role,Surface:surface,ExpiresAt:expires}); err != nil {
		return domain.ActivationChallenge{}, domain.ErrUnavailable
	}
	return domain.ActivationChallenge{ActivationID:activationID,MaskedPhone:identitysecurity.MaskPhone(a.PhoneE164),ExpiresAt:expires}, nil
}

func (s *Service) deliver(ctx context.Context, activationID string, a domain.Actor, role, surface string, expires time.Time) error {
	code, err := s.codeFor(activationID)
	if err != nil {
		return err
	}
	return s.sender.Send(ctx, activationdelivery.Message{Phone:a.PhoneE164,Code:code,ActorType:role,Surface:surface,ExpiresAt:expires})
}

func (s *Service) Consume(ctx context.Context, input domain.ActivationRequest) (domain.TokenPair, error) {
	role := strings.ToLower(strings.TrimSpace(input.ActorType))
	surface, ok := domain.SurfaceForRole(role)
	if !ok {
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
	defer func(){ _ = tx.Rollback() }()

	var challengeID, actorID, codeHash, status string
	var attempts int
	var expires time.Time
	err = tx.QueryRowContext(ctx,
		"SELECT id,actor_id,code_hash,status,attempts,expires_at FROM identity_activation_challenges WHERE actor_type=$1 AND phone_e164=$2 AND surface=$3 AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
		role, phone, surface).Scan(&challengeID, &actorID, &codeHash, &status, &attempts, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrInvalidActivation
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !expires.After(s.now()) {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_activation_challenges SET status='expired',updated_at=clock_timestamp() WHERE id=$1", challengeID); err != nil {
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

	a, err := actorByIDTx(ctx, tx, actorID)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if a.PhoneE164 != phone || !domain.ActorHasRole(a, role) ||
		a.Status == domain.ActorStatusSuspended || a.Status == domain.ActorStatusDeactivated {
		return domain.TokenPair{}, domain.ErrActorBlocked
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_activation_challenges SET status='consumed',consumed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
		challengeID); err != nil {
		return domain.TokenPair{}, err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_actors SET status='ACTIVE',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
		actorID); err != nil {
		return domain.TokenPair{}, err
	}
	a.Status = domain.ActorStatusActive
	a.Version++
	pair, err := s.sessions.CreateForActivationTx(ctx, tx, a, surface, input.DeviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "activation.consumed", actorID, actorID, "success", "", map[string]any{"surface":surface}); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
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

func actorByIDScoped(ctx context.Context, db *sql.DB, operatorContextID, actorID string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return db.QueryRowContext(ctx,
			"SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE id=$1 AND operator_context_id=$2",
			actorID, operatorContextID).Scan(dest...)
	})
}

func actorByIDTx(ctx context.Context, tx *sql.Tx, actorID string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return tx.QueryRowContext(ctx,
			"SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE id=$1 FOR UPDATE",
			actorID).Scan(dest...)
	})
}

type scanner func(dest ...any) error

func scanActor(scan scanner) (domain.Actor, error) {
	var a domain.Actor
	var roles pq.StringArray
	var raw []byte
	var status string
	if err := scan(&a.ID,&a.Username,&a.PhoneE164,&a.OperatorContextID,&roles,&raw,&a.PasswordHash,&status,&a.Version,&a.ProvisioningFingerprint,&a.CreatedByService); err != nil {
		return domain.Actor{}, err
	}
	a.Roles,a.Status=[]string(roles),domain.ActorStatus(status)
	if err := json.Unmarshal(raw,&a.Permissions); err != nil {
		return domain.Actor{}, err
	}
	if a.Permissions == nil {
		a.Permissions=[]domain.Permission{}
	}
	return a,nil
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil { metadata=map[string]any{} }
	raw, err := json.Marshal(metadata)
	if err != nil { return err }
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)",
		eventType,actorID,principal,outcome,correlationID,string(raw))
	return err
}
