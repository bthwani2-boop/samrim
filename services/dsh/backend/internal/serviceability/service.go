package serviceability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

const PolicyVersion = "CITY_SCOPE_V2_RADIUS_30KM"

// Until governed per-city boundaries exist, no city label alone can authorize
// a delivery across an implausible distance. Keep the quote guard in WLT aligned.
const maximumDeliveryDistanceMeters = 30_000

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
	if facts.StoreServiceCityID == facts.AddressServiceCityID && withinDeliveryCoverage(facts) {
		result.Status = "SERVICEABLE"
	} else {
		result.Status = "UNSERVICEABLE"
	}
	return result, nil
}

func withinDeliveryCoverage(f postgres.ServiceabilityFacts) bool {
	if !f.StoreOriginAvailable || !f.AddressFound {
		return false
	}
	for _, coord := range []float64{f.StoreOriginLatitude, f.StoreOriginLongitude, f.AddressLatitude, f.AddressLongitude} {
		if math.IsNaN(coord) || math.IsInf(coord, 0) {
			return false
		}
	}
	if math.Abs(f.StoreOriginLatitude) > 90 || math.Abs(f.AddressLatitude) > 90 ||
		math.Abs(f.StoreOriginLongitude) > 180 || math.Abs(f.AddressLongitude) > 180 {
		return false
	}
	lat1, lat2 := f.StoreOriginLatitude*math.Pi/180, f.AddressLatitude*math.Pi/180
	dLat := (f.AddressLatitude - f.StoreOriginLatitude) * math.Pi / 180
	dLon := (f.AddressLongitude - f.StoreOriginLongitude) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	a = math.Max(0, math.Min(1, a))
	return 2*6_371_000*math.Atan2(math.Sqrt(a), math.Sqrt(1-a)) <= maximumDeliveryDistanceMeters
}
