package captainstanding

// Captain interest is a one-way, unauthenticated contact form. It is not a
// standing application and never creates an Identity actor, role or session.
import (
	"context"
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	CaptainInterestPath         = "/v1/captain-interest"
	OperatorCaptainInterestPath = "/v1/operators/captain-interest"
)

type InterestSubmission struct {
	Name              string `json:"name"`
	Phone             string `json:"phone"`
	City              string `json:"city"`
	District          string `json:"district"`
	VehicleType       string `json:"vehicleType"`
	PlateRegistered   *bool  `json:"plateRegistered,omitempty"`
	PhoneType         string `json:"phoneType"`
	Experienced       bool   `json:"experienced"`
	ExperienceDetails string `json:"experienceDetails,omitempty"`
}
type Interest struct {
	ID int64 `json:"id"`
	InterestSubmission
	Contacted bool   `json:"contacted"`
	CreatedAt string `json:"createdAt"`
}
type InterestFilter struct {
	BeforeID    int64
	Limit       int
	City        string
	VehicleType string
	Contacted   *bool
}
type InterestPage struct {
	Items      []Interest `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}
type InterestRepository interface {
	Insert(context.Context, InterestSubmission) error
	List(context.Context, InterestFilter) (InterestPage, error)
	MarkContacted(context.Context, int64, string) (Interest, error)
}
type InterestService struct {
	identity Identity
	repo     InterestRepository
}

func NewInterestService(identity Identity, repo InterestRepository) *InterestService {
	return &InterestService{identity: identity, repo: repo}
}

var phonePattern = regexp.MustCompile(`^7[0-9]{8}$`)
var asciiPhone = regexp.MustCompile(`^(?:\+967|967)?(7[0-9]{8})$`)

func cleanInterestText(value string, min, max int) bool {
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return false
	}
	chars := []rune(value)
	if len(chars) < min || len(chars) > max {
		return false
	}
	for _, r := range chars {
		if unicode.IsControl(r) || r == '\u200b' || r == '\ufeff' {
			return false
		}
	}
	return true
}
func normalizeInterest(in InterestSubmission) (InterestSubmission, error) {
	matches := asciiPhone.FindStringSubmatch(in.Phone)
	if len(matches) != 2 {
		return InterestSubmission{}, ErrInvalidChange
	}
	in.Phone = matches[1]
	if !phonePattern.MatchString(in.Phone) || !cleanInterestText(in.Name, 4, 100) ||
		!cleanInterestText(in.City, 2, 80) || !cleanInterestText(in.District, 2, 100) ||
		(in.ExperienceDetails != "" && !cleanInterestText(in.ExperienceDetails, 1, 200)) {
		return InterestSubmission{}, ErrInvalidChange
	}
	switch in.VehicleType {
	case "MOTORCYCLE", "ELECTRIC":
		if in.PlateRegistered == nil {
			return InterestSubmission{}, ErrInvalidChange
		}
	case "BICYCLE", "NONE":
		if in.PlateRegistered != nil {
			return InterestSubmission{}, ErrInvalidChange
		}
	default:
		return InterestSubmission{}, ErrInvalidChange
	}
	if in.PhoneType != "SMART" && in.PhoneType != "BASIC" && in.PhoneType != "NONE" {
		return InterestSubmission{}, ErrInvalidChange
	}
	if !in.Experienced && in.ExperienceDetails != "" {
		return InterestSubmission{}, ErrInvalidChange
	}
	return in, nil
}
func (s *InterestService) Submit(ctx context.Context, candidate InterestSubmission) error {
	if s == nil || s.repo == nil {
		return ErrOwnerUnavailable
	}
	normalized, err := normalizeInterest(candidate)
	if err != nil {
		return err
	}
	if err = s.repo.Insert(ctx, normalized); err != nil {
		return err
	}
	return nil
}
func (s *InterestService) operator(ctx context.Context, bearer string) (Actor, error) {
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
	if actor.Role != "operator" || !validActorID(actor.ID) {
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
func (s *InterestService) List(ctx context.Context, bearer string, filter InterestFilter) (InterestPage, error) {
	if filter.Limit < 1 || filter.Limit > 50 || filter.BeforeID < 0 ||
		(filter.City != "" && !cleanInterestText(filter.City, 2, 80)) ||
		(filter.VehicleType != "" && filter.VehicleType != "MOTORCYCLE" &&
			filter.VehicleType != "ELECTRIC" && filter.VehicleType != "BICYCLE" && filter.VehicleType != "NONE") {
		return InterestPage{}, ErrInvalidChange
	}
	if _, err := s.operator(ctx, bearer); err != nil {
		return InterestPage{}, err
	}
	return s.repo.List(ctx, filter)
}
func (s *InterestService) MarkContacted(ctx context.Context, bearer string, id int64) (Interest, error) {
	if id < 1 {
		return Interest{}, ErrInvalidChange
	}
	actor, err := s.operator(ctx, bearer)
	if err != nil {
		return Interest{}, err
	}
	return s.repo.MarkContacted(ctx, id, actor.ID)
}
