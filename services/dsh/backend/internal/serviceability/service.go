package serviceability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

const PolicyVersion = "CITY_SCOPE_V1"

var (
	ErrClientSessionForbidden = errors.New("an active app-client session is required")
	ErrIdentityUnavailable    = errors.New("partner Identity eligibility is unavailable")
)

type Result struct {
	Status string
	Facts  postgres.ServiceabilityFacts
}

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identityClient *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identityClient == nil || db == nil {
		return nil, errors.New("serviceability configuration is invalid")
	}
	return &Service{identity: identityClient, db: db}, nil
}

func (s *Service) Evaluate(ctx context.Context, accessToken, storeID, addressID string) (Result, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return Result{}, err
	}
	if identity.Role != "client" || identity.Surface != "app-client" || strings.TrimSpace(identity.Subject) == "" {
		return Result{}, ErrClientSessionForbidden
	}
	facts, err := postgres.ReadServiceabilityFacts(ctx, s.db, storeID, identity.Subject, addressID)
	if err != nil {
		return Result{}, err
	}
	result := Result{Status: "UNAVAILABLE", Facts: facts}
	if !facts.StoreFound || !facts.AddressFound || !facts.StoreOriginAvailable || facts.StoreServiceCityID == "" || facts.AddressServiceCityID == "" || facts.ServiceCityID == "" || !facts.ServiceCityActive || !facts.AddressCityFound || !facts.AddressCityActive || facts.StorePublicationState != "published" || !facts.HasPublishedOffer {
		return result, nil
	}
	partner, err := s.identity.ReadActorRole(ctx, facts.StorePartnerActorID, "partner")
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) && identityErr.Status == 404 {
			return result, nil
		}
		return Result{}, fmt.Errorf("%w: %w", ErrIdentityUnavailable, err)
	}
	if partner.Role != "partner" || !partner.Enabled || !partner.SecurityEnabled || partner.ActivatedAt == nil {
		return result, nil
	}
	if facts.StoreServiceCityID == facts.AddressServiceCityID {
		result.Status = "SERVICEABLE"
	} else {
		result.Status = "UNSERVICEABLE"
	}
	return result, nil
}
