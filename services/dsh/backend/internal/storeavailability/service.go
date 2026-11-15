package storeavailability

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	ErrUnauthorized          = errors.New("UNAUTHENTICATED")
	ErrIdentityUnavailable   = errors.New("IDENTITY_OWNER_UNAVAILABLE")
	ErrForbidden             = errors.New("STORE_OPERATION_FORBIDDEN")
	ErrInvalidChange         = errors.New("INVALID_OPERATIONAL_CHANGE")
	ErrPolicyUnavailable     = errors.New("OPERATIONAL_POLICY_UNAVAILABLE")
	ErrPolicyVersionConflict = errors.New("OPERATIONAL_POLICY_VERSION_CONFLICT")
	ErrVersionConflict       = errors.New("STORE_AVAILABILITY_VERSION_CONFLICT")
	ErrOperationConflict     = errors.New("IDEMPOTENCY_KEY_REUSED")
	ErrStoreMissing          = errors.New("STORE_NOT_FOUND")
	ErrUnknownResult         = errors.New("OPERATION_RESULT_UNKNOWN")
)

type ActorRole string

const (
	MerchantRole ActorRole = "MERCHANT"
	OperatorRole ActorRole = "OPERATOR"
)

type VerifiedActor struct {
	Subject string
	Role    ActorRole
}
type IdentitySessions interface {
	// ResolveCurrentSession must contact Identity's current authoritative session
	// state, never decode an unverified client-supplied actor header.
	ResolveCurrentSession(context.Context, string) (VerifiedActor, error)
	RequireOperatorPermission(context.Context, string, string, string) error
}
type StoreGrants interface {
	// DSH checks current Store ownership or an accepted, nonrevoked store_operations grant.
	RequireStoreAction(context.Context, string, string, string) error
	// StoreTimezone is the approved DSH Store/City IANA zone; client must not choose it.
	StoreTimezone(context.Context, string) (string, error)
}
type Limits struct {
	MaxPause              time.Duration
	MaxPreparationMinutes int
	Version               int64
}
type PolicySource interface {
	// Read only from current DSH Operator Policies, never from a UI default.
	CurrentLimits(context.Context, string) (Limits, error)
}
type Snapshot struct {
	StoreID            string         `json:"storeId"`
	Timezone           string         `json:"timezone"`
	Weekly             []WeeklyWindow `json:"weekly"`
	PausedUntil        *time.Time     `json:"pausedUntil,omitempty"`
	PreparationMinutes int            `json:"preparationMinutes"`
	Version            int64          `json:"version"`
	ActingActorID      string         `json:"actingActorId"`
	Reason             string         `json:"reason"`
}
type Change struct {
	StoreID            string
	OperationID        string
	ExpectedVersion    int64
	Timezone           string
	Weekly             []WeeklyWindow
	PausedUntil        *time.Time
	PreparationMinutes int
	Reason             string
}
type AuthorizedChange struct {
	Change
	ActorID         string
	AuthoritySource string
	PolicyVersion   int64
}
type Repository interface {
	Read(context.Context, string) (Snapshot, error)
	ReadAuthorized(context.Context, string, string, string) (Snapshot, error)
	Apply(context.Context, AuthorizedChange) (Snapshot, bool, error)
}

type Service struct {
	identity IdentitySessions
	grants   StoreGrants
	policies PolicySource
	repo     Repository
	now      func() time.Time
}

var operationIDRule = regexp.MustCompile(`^[A-Za-z0-9._-]{8,128}$`)

func NewService(identity IdentitySessions, grants StoreGrants, policies PolicySource, repo Repository) (*Service, error) {
	if identity == nil || grants == nil || policies == nil || repo == nil {
		return nil, ErrUnauthorized
	}
	return &Service{identity: identity, grants: grants, policies: policies, repo: repo, now: time.Now}, nil
}
func (s *Service) authorize(ctx context.Context, token, storeID string) (VerifiedActor, string, error) {
	if strings.TrimSpace(token) == "" || strings.TrimSpace(storeID) == "" {
		return VerifiedActor{}, "", ErrUnauthorized
	}
	actor, err := s.identity.ResolveCurrentSession(ctx, token)
	if errors.Is(err, ErrIdentityUnavailable) {
		return VerifiedActor{}, "", ErrIdentityUnavailable
	}
	if err != nil || strings.TrimSpace(actor.Subject) == "" {
		return VerifiedActor{}, "", ErrUnauthorized
	}
	switch actor.Role {
	case MerchantRole:
		if err = s.grants.RequireStoreAction(ctx, actor.Subject, storeID, "store_operations"); err != nil {
			return VerifiedActor{}, "", ErrForbidden
		}
		return actor, "MERCHANT_STORE_GRANT", nil
	case OperatorRole:
		if err = s.identity.RequireOperatorPermission(ctx, token, actor.Subject, "operations"); err != nil {
			if errors.Is(err, ErrIdentityUnavailable) {
				return VerifiedActor{}, "", ErrIdentityUnavailable
			}
			if errors.Is(err, ErrUnauthorized) {
				return VerifiedActor{}, "", ErrUnauthorized
			}
			return VerifiedActor{}, "", ErrForbidden
		}
		return actor, "OPERATOR_OPERATIONS", nil
	default:
		return VerifiedActor{}, "", ErrForbidden
	}
}
func (s *Service) ReadForActor(ctx context.Context, token, storeID string) (Snapshot, error) {
	actor, authority, err := s.authorize(ctx, token, storeID)
	if err != nil {
		return Snapshot{}, err
	}
	return s.repo.ReadAuthorized(ctx, storeID, actor.Subject, authority)
}
func (s *Service) Change(ctx context.Context, token string, change Change) (Snapshot, bool, error) {
	actor, authority, err := s.authorize(ctx, token, change.StoreID)
	if err != nil {
		return Snapshot{}, false, err
	}
	if !operationIDRule.MatchString(change.OperationID) || change.ExpectedVersion < 1 ||
		len([]rune(strings.TrimSpace(change.Reason))) < 1 ||
		len([]rune(change.Reason)) > 300 || change.PreparationMinutes < 0 {
		return Snapshot{}, false, ErrInvalidChange
	}
	approvedTimezone, lookupErr := s.grants.StoreTimezone(ctx, change.StoreID)
	if lookupErr != nil {
		return Snapshot{}, false, ErrPolicyUnavailable
	}
	if approvedTimezone == "" {
		return Snapshot{}, false, ErrInvalidTimezone
	}
	if change.Timezone != "" && change.Timezone != approvedTimezone {
		return Snapshot{}, false, ErrInvalidChange
	}
	if _, err = time.LoadLocation(approvedTimezone); err != nil {
		return Snapshot{}, false, ErrInvalidTimezone
	}
	change.Timezone = approvedTimezone
	if err = ValidateSchedule(change.Weekly); err != nil {
		return Snapshot{}, false, err
	}
	limits, err := s.policies.CurrentLimits(ctx, change.StoreID)
	if err != nil {
		return Snapshot{}, false, ErrPolicyUnavailable
	}
	if limits.Version < 1 || limits.MaxPreparationMinutes < 0 || limits.MaxPause < 0 {
		return Snapshot{}, false, ErrPolicyUnavailable
	}
	if change.PreparationMinutes > limits.MaxPreparationMinutes {
		return Snapshot{}, false, ErrInvalidChange
	}
	if change.PausedUntil != nil {
		remaining := change.PausedUntil.Sub(s.now())
		if limits.MaxPause <= 0 || remaining <= 0 || remaining > limits.MaxPause {
			return Snapshot{}, false, ErrInvalidChange
		}
	}
	change.Reason = strings.TrimSpace(change.Reason)
	return s.repo.Apply(ctx, AuthorizedChange{
		Change: change, ActorID: actor.Subject, AuthoritySource: authority, PolicyVersion: limits.Version,
	})
}
