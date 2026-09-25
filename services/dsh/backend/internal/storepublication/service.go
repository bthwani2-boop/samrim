package storepublication

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrOperatorNotActive             = errors.New("operator actor is not active")
	ErrPublicationReadinessBlocked   = errors.New("store publication readiness is blocked")
	ErrPartnerIdentityUnavailable    = errors.New("partner Identity eligibility is unavailable")
	PartnerIdentityNotEligibleReason = "PARTNER_IDENTITY_NOT_ELIGIBLE"
	FinancialProfileNotReadyReason   = "FINANCIAL_PROFILE_NOT_READY"
	ServiceCityNotEligibleReason     = "SERVICE_CITY_NOT_ELIGIBLE"
	CatalogNotReadyReason            = "CATALOG_NOT_READY"
)

type PublicationReadiness struct {
	Ready         bool
	BlockedReason string
}

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	wlt      *wltintegration.Client
}

func New(identity *identityintegration.Client, db *sql.DB, wlt *wltintegration.Client) (*Service, error) {
	if identity == nil || db == nil || wlt == nil {
		return nil, errors.New("store publication configuration is invalid")
	}
	return &Service{identity: identity, db: db, wlt: wlt}, nil
}

func (s *Service) ReconcileFieldCommissions(ctx context.Context) error {
	items, err := postgres.ListPendingFieldCommissionPublications(ctx, s.db, 100)
	if err != nil {
		return err
	}
	for _, item := range items {
		if _, _, finalizeErr := s.wlt.FinalizeFieldCommission(ctx, item.StoreID, item.FieldActorID, item.VerticalID, item.IdempotencyKey, item.CorrelationID); finalizeErr != nil {
			if markErr := postgres.MarkFieldCommissionPublicationFailure(ctx, s.db, item.ID, finalizeErr.Error()); markErr != nil {
				return markErr
			}
			continue
		}
		if err := postgres.MarkFieldCommissionPublicationPosted(ctx, s.db, item.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Publish(ctx context.Context, storeID, requestedState string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.PublicationResult, PublicationReadiness, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.PublicationResult{}, PublicationReadiness{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.PublicationResult{}, PublicationReadiness{}, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, actingActorID, "partners"); err != nil {
		return postgres.PublicationResult{}, PublicationReadiness{}, err
	}
	requestHash := postgres.HashStorePublicationRequest(storeID, requestedState, expectedVersion)
	var readiness PublicationReadiness
	result, err := postgres.SetStorePublicationWithGuard(ctx, s.db, storeID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, func(guardCtx context.Context, store postgres.StoreRecord) error {
		current, readinessErr := s.ReadinessForStore(guardCtx, store)
		readiness = current
		if readinessErr != nil {
			return readinessErr
		}
		if requestedState == "published" && !current.Ready {
			return ErrPublicationReadinessBlocked
		}
		return nil
	})
	if err != nil {
		return postgres.PublicationResult{}, readiness, err
	}
	if result.Replayed {
		readiness, err = s.ReadinessForStore(ctx, result.Store)
		if err != nil {
			return postgres.PublicationResult{}, PublicationReadiness{}, err
		}
	}
	return result, readiness, nil
}

func (s *Service) SetFulfillmentModes(ctx context.Context, storeID string, modes []string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.StoreFulfillmentModesResult, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.StoreFulfillmentModesResult{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.StoreFulfillmentModesResult{}, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, actingActorID, "partners"); err != nil {
		return postgres.StoreFulfillmentModesResult{}, err
	}
	return postgres.SetStoreFulfillmentModes(ctx, s.db, storeID, actingActorID, modes, expectedVersion, idempotencyKey, correlationID)
}

func (s *Service) ReadForOperator(ctx context.Context, storeID, actingActorID string) (postgres.StoreRecord, PublicationReadiness, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, actingActorID, "partners"); err != nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, err
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, err
	}
	readiness, err := s.ReadinessForStore(ctx, store)
	return store, readiness, err
}

func (s *Service) ListForOperator(ctx context.Context, state, query, serviceCityID, searchMode, sort, actingActorID string, limit int, cursor string) (postgres.OperatorStorePage, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	state = strings.TrimSpace(state)
	if actingActorID == "" || len(actingActorID) > 128 {
		return postgres.OperatorStorePage{}, postgres.ErrOperatorStoreInvalidActor
	}
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.OperatorStorePage{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.OperatorStorePage{}, ErrOperatorNotActive
	}
	if err := s.requireStoreRegistryPermission(ctx, actingActorID, state); err != nil {
		return postgres.OperatorStorePage{}, err
	}
	return postgres.ListStoresForOperator(ctx, s.db, state, query, serviceCityID, searchMode, sort, limit, cursor)
}

func (s *Service) requireStoreRegistryPermission(ctx context.Context, actingActorID, state string) error {
	var denied error
	for _, permission := range storeRegistryPermissions(state) {
		err := s.identity.RequireOperatorPermission(ctx, actingActorID, permission)
		if err == nil {
			return nil
		}
		var identityErr *identityclient.Error
		if !errors.As(err, &identityErr) || identityErr.Status != http.StatusForbidden {
			return err
		}
		denied = err
	}
	return denied
}

func storeRegistryPermissions(state string) []string {
	if strings.TrimSpace(state) == "published" {
		return []string{"partners", "marketing", "platform_policies"}
	}
	return []string{"partners"}
}

func (s *Service) ListPublished(ctx context.Context, serviceCityID string, latitude, longitude *float64) ([]postgres.PublicStoreRecord, error) {
	var stores []postgres.PublicStoreRecord
	var err error
	if latitude != nil && longitude != nil {
		stores, err = postgres.ListPublishedStoresNear(ctx, s.db, serviceCityID, *latitude, *longitude)
	} else {
		stores, err = postgres.ListPublishedStores(ctx, s.db, serviceCityID)
	}
	if err != nil {
		return nil, err
	}
	visible := make([]postgres.PublicStoreRecord, 0, len(stores))
	for _, store := range stores {
		readiness, readinessErr := s.ReadinessForPartner(ctx, store.PartnerActorID)
		if readinessErr != nil {
			return nil, readinessErr
		}
		if readiness.Ready {
			visible = append(visible, store)
		}
	}
	return visible, nil
}

func (s *Service) ReadPublished(ctx context.Context, storeID, serviceCityID string) (postgres.PublicStoreRecord, error) {
	store, err := postgres.ReadPublishedStore(ctx, s.db, storeID, serviceCityID)
	if err != nil {
		return postgres.PublicStoreRecord{}, err
	}
	readiness, err := s.ReadinessForPartner(ctx, store.PartnerActorID)
	if err != nil {
		return postgres.PublicStoreRecord{}, err
	}
	if !readiness.Ready {
		return postgres.PublicStoreRecord{}, postgres.ErrStoreNotFound
	}
	return store, nil
}

func (s *Service) ReadinessForStore(ctx context.Context, store postgres.StoreRecord) (PublicationReadiness, error) {
	if strings.TrimSpace(store.ServiceCityID) == "" {
		return blockedReadiness(ServiceCityNotEligibleReason), nil
	}
	city, err := postgres.ReadServiceCity(ctx, s.db, store.ServiceCityID)
	if errors.Is(err, postgres.ErrServiceCityNotFound) {
		return blockedReadiness(ServiceCityNotEligibleReason), nil
	}
	if err != nil {
		return PublicationReadiness{}, err
	}
	if !city.Active {
		return blockedReadiness(ServiceCityNotEligibleReason), nil
	}
	catalogReady, err := postgres.HasPublishableCatalog(ctx, s.db, store.ID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if !catalogReady {
		return blockedReadiness(CatalogNotReadyReason), nil
	}
	return s.ReadinessForPartner(ctx, store.PartnerActorID)
}

func (s *Service) ReadinessForPartner(ctx context.Context, partnerActorID string) (PublicationReadiness, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	if partnerActorID == "" {
		return blockedReadiness(PartnerIdentityNotEligibleReason), nil
	}
	partner, err := s.identity.ReadActorRole(ctx, partnerActorID, "partner")
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) && identityErr.Status == 404 {
			return blockedReadiness(PartnerIdentityNotEligibleReason), nil
		}
		return PublicationReadiness{}, fmt.Errorf("%w: %w", ErrPartnerIdentityUnavailable, err)
	}
	readiness := evaluatePartnerReadiness(partner)
	if !readiness.Ready {
		return readiness, nil
	}
	financialProfileActive, err := postgres.HasActiveFinancialProfileForPartner(ctx, s.db, partnerActorID)
	if err != nil {
		return PublicationReadiness{}, fmt.Errorf("read partner financial profile readiness: %w", err)
	}
	if !financialProfileActive {
		return blockedReadiness(FinancialProfileNotReadyReason), nil
	}
	return readiness, nil
}

func blockedReadiness(reason string) PublicationReadiness {
	return PublicationReadiness{BlockedReason: reason}
}

func evaluatePartnerReadiness(partner identityclient.ActorRoleView) PublicationReadiness {
	if partner.Role != "partner" || !partner.Enabled || !partner.SecurityEnabled || partner.ActivatedAt == nil {
		return blockedReadiness(PartnerIdentityNotEligibleReason)
	}
	return PublicationReadiness{Ready: true}
}
