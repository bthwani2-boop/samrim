// Package captainstanding owns DSH Captain operational eligibility.
// Global Captain roles and credentials remain exclusively Identity-owned.
package captainstanding

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

var (
	ErrUnauthorized     = errors.New("UNAUTHORIZED")
	ErrForbidden        = errors.New("FORBIDDEN")
	ErrNotEligible      = errors.New("CAPTAIN_NOT_ELIGIBLE")
	ErrOwnerUnavailable = errors.New("OWNER_UNAVAILABLE")
	ErrInvalidChange    = errors.New("INVALID_REQUEST")
	ErrVersionConflict  = errors.New("CAPTAIN_STANDING_VERSION_CONFLICT")
	ErrUnknownResult    = errors.New("OPERATION_RESULT_UNKNOWN")
)

type Status string

const (
	Pending   Status = "PENDING"
	Approved  Status = "APPROVED"
	Suspended Status = "SUSPENDED"
	Revoked   Status = "REVOKED"
)

type Actor struct {
	ID   string
	Role string
}

type Standing struct {
	ActorID string `json:"actorId"`
	Status  Status `json:"status"`
	Version int64  `json:"version"`
}

type Change struct {
	ActorID         string
	Status          Status
	ExpectedVersion int64
	OperationID     string
	Reason          string
	ActingActorID   string
}

type Identity interface {
	Resolve(context.Context, string) (Actor, error)
	RequireOperations(context.Context, string, string) error
}

type Repository interface {
	Read(context.Context, string) (Standing, error)
	Apply(context.Context, string) (Standing, error)
	Change(context.Context, Change) (Standing, error)
}

type Service struct {
	identity Identity
	repo     Repository
}

func NewService(identity Identity, repo Repository) *Service {
	return &Service{identity: identity, repo: repo}
}

func validActorID(actorID string) bool {
	return len(actorID) > 0 && len(actorID) <= 128 &&
		strings.TrimSpace(actorID) == actorID &&
		!strings.ContainsAny(actorID, "\r\n\t")
}

func (s *Service) resolve(ctx context.Context, bearer string) (Actor, error) {
	if s == nil || s.identity == nil || s.repo == nil {
		return Actor{}, ErrOwnerUnavailable
	}
	if bearer == "" || strings.TrimSpace(bearer) != bearer || strings.ContainsAny(bearer, "\r\n\t") {
		return Actor{}, ErrUnauthorized
	}
	actor, err := s.identity.Resolve(ctx, bearer)
	if errors.Is(err, ErrUnauthorized) {
		return Actor{}, ErrUnauthorized
	}
	if err != nil {
		return Actor{}, ErrOwnerUnavailable
	}
	if !validActorID(actor.ID) {
		return Actor{}, ErrOwnerUnavailable
	}
	return actor, nil
}

// Apply creates or recovers a DSH application for the current Customer actor.
// The repository must never reactivate an existing suspended/revoked record.
func (s *Service) Apply(ctx context.Context, bearer string) (Standing, error) {
	actor, err := s.resolve(ctx, bearer)
	if err != nil {
		return Standing{}, err
	}
	if actor.Role != "customer" {
		return Standing{}, ErrForbidden
	}
	standing, err := s.repo.Apply(ctx, actor.ID)
	if err != nil {
		return Standing{}, err
	}
	if standing.ActorID != actor.ID || standing.Version < 1 {
		return Standing{}, ErrOwnerUnavailable
	}
	switch standing.Status {
	case Pending, Approved, Suspended, Revoked:
		return standing, nil
	default:
		return Standing{}, ErrOwnerUnavailable
	}
}

// ReadSelf uses current Identity authentication, then current DSH standing.
// Only APPROVED is suitable for a Captain role request or Captain app access.
func (s *Service) ReadSelf(ctx context.Context, bearer, requiredRole string) (Standing, error) {
	if requiredRole != "customer" && requiredRole != "captain" {
		return Standing{}, ErrForbidden
	}
	actor, err := s.resolve(ctx, bearer)
	if err != nil {
		return Standing{}, err
	}
	if actor.Role != requiredRole {
		return Standing{}, ErrForbidden
	}
	standing, err := s.repo.Read(ctx, actor.ID)
	if errors.Is(err, ErrNotEligible) {
		return Standing{}, ErrNotEligible
	}
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if standing.ActorID != actor.ID || standing.Version < 1 {
		return Standing{}, ErrOwnerUnavailable
	}
	if standing.Status != Approved {
		return Standing{}, ErrNotEligible
	}
	return standing, nil
}

var operationID = regexp.MustCompile(`^[A-Za-z0-9._-]{8,128}$`)

// Change may be performed only by a current Operator with effective operations
// permission. The verified Identity actor is the audit writer, never the caller body.
func (s *Service) Change(ctx context.Context, bearer string, cmd Change) (Standing, error) {
	if !validActorID(cmd.ActorID) || cmd.ExpectedVersion < 1 ||
		(cmd.Status != Approved && cmd.Status != Suspended && cmd.Status != Revoked) ||
		!operationID.MatchString(cmd.OperationID) ||
		len(strings.TrimSpace(cmd.Reason)) < 1 || len([]rune(cmd.Reason)) > 300 ||
		cmd.ActingActorID != "" {
		return Standing{}, ErrInvalidChange
	}
	actor, err := s.resolve(ctx, bearer)
	if err != nil {
		return Standing{}, err
	}
	if actor.Role != "operator" {
		return Standing{}, ErrForbidden
	}
	if err = s.identity.RequireOperations(ctx, bearer, actor.ID); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			return Standing{}, ErrUnauthorized
		}
		if errors.Is(err, ErrForbidden) {
			return Standing{}, ErrForbidden
		}
		return Standing{}, ErrOwnerUnavailable
	}
	// The same canonical actor may hold both Operator and Customer roles.
	// Operations permission never authorizes approval of one's own standing.
	if cmd.Status == Approved && cmd.ActorID == actor.ID {
		return Standing{}, ErrForbidden
	}
	cmd.ActingActorID = actor.ID
	standing, err := s.repo.Change(ctx, cmd)
	if err != nil {
		return Standing{}, err
	}
	if standing.ActorID != cmd.ActorID || standing.Status != cmd.Status || standing.Version < 1 {
		return Standing{}, ErrOwnerUnavailable
	}
	return standing, nil
}
