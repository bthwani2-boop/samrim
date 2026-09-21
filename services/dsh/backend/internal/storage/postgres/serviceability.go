package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ServiceabilityFacts struct {
	StoreID               string
	StoreFound            bool
	StorePartnerActorID   string
	StoreVersion          int
	StoreServiceCityID    string
	StorePublicationState string
	StoreOriginLatitude   float64
	StoreOriginLongitude  float64
	StoreOriginAvailable  bool
	AddressID             string
	AddressFound          bool
	AddressVersion        int
	AddressServiceCityID  string
	AddressLatitude       float64
	AddressLongitude      float64
	ServiceCityID         string
	ServiceCityVersion    int
	ServiceCityActive     bool
	AddressCityVersion    int
	AddressCityActive     bool
	AddressCityFound      bool
	HasPublishedOffer     bool
	EvaluatedAt           time.Time
}

func ReadServiceabilityFacts(ctx context.Context, db *sql.DB, storeID, clientActorID, addressID string) (ServiceabilityFacts, error) {
	if db == nil {
		return ServiceabilityFacts{}, errors.New("DSH database is nil")
	}
	storeID = strings.TrimSpace(storeID)
	clientActorID = strings.TrimSpace(clientActorID)
	addressID = strings.TrimSpace(addressID)
	if storeID == "" || clientActorID == "" || addressID == "" {
		return ServiceabilityFacts{}, errors.New("serviceability facts are invalid")
	}

	var facts ServiceabilityFacts
	var storeIDValue, partnerActorID, storeCityID, addressIDValue, addressCityID, serviceCityID sql.NullString
	var storeVersion, addressVersion, serviceCityVersion, addressCityVersion sql.NullInt64
	var storeState sql.NullString
	var serviceCityActive, addressCityActive sql.NullBool
	var storeOriginLatitude, storeOriginLongitude, addressLatitude, addressLongitude sql.NullFloat64
	var addressCityFound, hasPublishedOffer bool
	visibleOfferConditions := strings.Join(customerVisibleOfferConditionsForAliases("co", "cv", "cp", "s"), " AND ")
	err := db.QueryRowContext(ctx, `
		SELECT s.id, s.partner_actor_id, s.version, s.service_city_id, s.publication_state,
		       s.delivery_origin_latitude, s.delivery_origin_longitude,
		       a.id, a.version, a.service_city_id, a.latitude, a.longitude,
		       sc.id, sc.version, sc.active,
		       ac.id IS NOT NULL, ac.version, ac.active,
		       EXISTS (
					SELECT 1
					FROM dsh.catalog_store_offers co
					JOIN dsh.catalog_product_variants cv ON cv.id=co.variant_id
					JOIN dsh.catalog_products cp ON cp.id=cv.product_id
					WHERE co.store_id=s.id AND `+visibleOfferConditions+`
			)
		FROM (SELECT $1::text AS store_id, $2::text AS address_id, $3::text AS client_actor_id) input
		LEFT JOIN dsh.stores s ON s.id=input.store_id
		LEFT JOIN dsh.delivery_addresses a ON a.id=input.address_id AND a.client_actor_id=input.client_actor_id
		LEFT JOIN dsh.service_cities sc ON sc.id=s.service_city_id
		LEFT JOIN dsh.service_cities ac ON ac.id=a.service_city_id`, storeID, addressID, clientActorID).Scan(
		&storeIDValue, &partnerActorID, &storeVersion, &storeCityID, &storeState, &storeOriginLatitude, &storeOriginLongitude,
		&addressIDValue, &addressVersion, &addressCityID, &addressLatitude, &addressLongitude,
		&serviceCityID, &serviceCityVersion, &serviceCityActive,
		&addressCityFound, &addressCityVersion, &addressCityActive,
		&hasPublishedOffer)
	if err != nil {
		return ServiceabilityFacts{}, fmt.Errorf("read serviceability facts: %w", err)
	}
	if storeIDValue.Valid {
		facts.StoreFound = true
		facts.StoreID = storeIDValue.String
		facts.StorePartnerActorID = partnerActorID.String
		facts.StoreVersion = int(storeVersion.Int64)
		facts.StoreServiceCityID = storeCityID.String
		facts.StorePublicationState = storeState.String
		facts.StoreOriginAvailable = storeOriginLatitude.Valid && storeOriginLongitude.Valid
		if storeOriginLatitude.Valid {
			facts.StoreOriginLatitude = storeOriginLatitude.Float64
		}
		if storeOriginLongitude.Valid {
			facts.StoreOriginLongitude = storeOriginLongitude.Float64
		}
	}
	if addressIDValue.Valid {
		facts.AddressFound = true
		facts.AddressID = addressIDValue.String
		facts.AddressVersion = int(addressVersion.Int64)
		facts.AddressServiceCityID = addressCityID.String
		if addressLatitude.Valid {
			facts.AddressLatitude = addressLatitude.Float64
		}
		if addressLongitude.Valid {
			facts.AddressLongitude = addressLongitude.Float64
		}
	}
	if serviceCityID.Valid {
		facts.ServiceCityID = serviceCityID.String
		facts.ServiceCityVersion = int(serviceCityVersion.Int64)
		facts.ServiceCityActive = serviceCityActive.Valid && serviceCityActive.Bool
	}
	facts.AddressCityFound = addressCityFound
	facts.AddressCityVersion = int(addressCityVersion.Int64)
	facts.AddressCityActive = addressCityActive.Valid && addressCityActive.Bool
	facts.HasPublishedOffer = hasPublishedOffer
	facts.EvaluatedAt = time.Now().UTC()
	return facts, nil
}
