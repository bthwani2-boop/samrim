package captainstanding

import (
	"context"
	"encoding/base64"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

type StandingPage struct {
	Items      []Standing `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}

func reviewStatus(status Status) bool {
	return status == Pending || status == Approved || status == Suspended || status == Revoked
}
func reviewActorID(actorID string) bool {
	return validActorID(actorID) && utf8.ValidString(actorID) &&
		!strings.ContainsAny(actorID, "/\\\x00") && actorID != "." && actorID != ".."
}
func reviewAfter(status Status, cursor string) (string, error) {
	if cursor == "" {
		return "", nil
	}
	if len(cursor) > 512 {
		return "", ErrInvalidChange
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(cursor)
	if err != nil || !utf8.Valid(decoded) {
		return "", ErrInvalidChange
	}
	parts := strings.SplitN(string(decoded), "\n", 2)
	if len(parts) != 2 || parts[0] != string(status) || !reviewActorID(parts[1]) {
		return "", ErrInvalidChange
	}
	return parts[1], nil
}
func parseReviewQuery(raw string) (Status, int, string, error) {
	if len(raw) > 2048 {
		return "", 0, "", ErrInvalidChange
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return "", 0, "", ErrInvalidChange
	}
	for key, value := range values {
		if (key != "status" && key != "limit" && key != "cursor") || len(value) != 1 || !utf8.ValidString(value[0]) || value[0] == "" {
			return "", 0, "", ErrInvalidChange
		}
	}
	status, limit := Pending, 20
	if values.Has("status") {
		status = Status(values.Get("status"))
	}
	if !reviewStatus(status) {
		return "", 0, "", ErrInvalidChange
	}
	if values.Has("limit") {
		limit, err = strconv.Atoi(values.Get("limit"))
		if err != nil || limit < 1 || limit > 50 || strconv.Itoa(limit) != values.Get("limit") {
			return "", 0, "", ErrInvalidChange
		}
	}
	cursor := values.Get("cursor")
	if _, err = reviewAfter(status, cursor); err != nil {
		return "", 0, "", err
	}
	return status, limit, cursor, nil
}
func (s *Service) requireReviewOperator(ctx context.Context, bearer string) (Actor, error) {
	actor, err := s.resolve(ctx, bearer)
	if err != nil {
		return Actor{}, err
	}
	if actor.Role != "operator" {
		return Actor{}, ErrForbidden
	}
	if err = s.identity.RequireOperations(ctx, bearer, actor.ID); err != nil {
		if errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
			return Actor{}, err
		}
		return Actor{}, ErrOwnerUnavailable
	}
	return actor, nil
}
func (s *Service) ListForOperator(ctx context.Context, bearer string, status Status, limit int, cursor string) (StandingPage, error) {
	if !reviewStatus(status) || limit < 1 || limit > 50 {
		return StandingPage{}, ErrInvalidChange
	}
	after, err := reviewAfter(status, cursor)
	if err != nil {
		return StandingPage{}, err
	}
	if _, err = s.requireReviewOperator(ctx, bearer); err != nil {
		return StandingPage{}, err
	}
	items, err := s.repo.List(ctx, status, after, limit+1)
	if err != nil {
		return StandingPage{}, ErrOwnerUnavailable
	}
	if len(items) > limit+1 {
		return StandingPage{}, ErrOwnerUnavailable
	}
	seen := map[string]bool{}
	for _, item := range items {
		if !reviewActorID(item.ActorID) || item.Status != status || item.Version < 1 || seen[item.ActorID] {
			return StandingPage{}, ErrOwnerUnavailable
		}
		seen[item.ActorID] = true
	}
	page := StandingPage{Items: items}
	if page.Items == nil {
		page.Items = []Standing{}
	}
	if len(items) > limit {
		page.Items = items[:limit]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(string(status) + "\n" + page.Items[limit-1].ActorID))
	}
	return page, nil
}
func (s *Service) ReadForOperator(ctx context.Context, bearer, actorID string) (Standing, error) {
	if !reviewActorID(actorID) {
		return Standing{}, ErrInvalidChange
	}
	if _, err := s.requireReviewOperator(ctx, bearer); err != nil {
		return Standing{}, err
	}
	standing, err := s.repo.Read(ctx, actorID)
	if errors.Is(err, ErrNotEligible) {
		return Standing{}, ErrNotFound
	}
	if err != nil || standing.ActorID != actorID || !reviewStatus(standing.Status) || standing.Version < 1 {
		return Standing{}, ErrOwnerUnavailable
	}
	return standing, nil
}
