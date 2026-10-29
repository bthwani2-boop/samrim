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
	ErrOperatorNotActive                 = errors.New("operator actor is not active")
	ErrPublicationReadinessBlocked       = errors.New("store publication readiness is blocked")
	ErrPartnerIdentityUnavailable        = errors.New("partner Identity eligibility is unavailable")
	ErrStoreFulfillmentAgreementRequired = errors.New("published store fulfillment modes require a matching active store commercial agreement")
	PartnerIdentityNotEligibleReason     = "PARTNER_IDENTITY_NOT_ELIGIBLE"
	FinancialProfileNotReadyReason       = "FINANCIAL_PROFILE_NOT_READY"
	ServiceCityNotEligibleReason         = "SERVICE_CITY_NOT_ELIGIBLE"
	CatalogNotReadyReason                = "CATALOG_NOT_READY"
	CommercialAgreementNotReadyReason    = "COMMERCIAL_AGREEMENT_NOT_READY"
	StoreLogoNotReadyReason              = "STORE_LOGO_NOT_READY"
	StoreCoverNotReadyReason             = "STORE_COVER_NOT_READY"
	StoreScheduleNotReadyReason          = "STORE_SCHEDULE_NOT_READY"
)

type PublicationReadiness struct {
	Ready          bool
	BlockedReason  string
	BlockedReasons []string
}

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	wlt      *wltintegration.Client
}

type SetCommercialStoreTypeInput struct {
	StoreID         string
	TypeID          string
	Reason          string
	ExpectedVersion int
	IdempotencyKey  string
	ActingActorID   string
	CorrelationID   string
}

func New(identity *identityintegration.Client, db *sql.DB, wlt *wltintegration.Client) (*Service, error) {
	if identity == nil || db == nil || wlt == nil {
		return nil, errors.New("store publication configuration is invalid")
	}
	return &Service{identity: identity, db: db, wlt: wlt}, nil
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
		var readinessErr error
		readiness, readinessErr = evaluatePublicationGuard(guardCtx, requestedState, store, s.ReadinessForStore)
		return readinessErr
	})
	if err != nil {
		return postgres.PublicationResult{}, readiness, err
	}
	if result.Replayed && requestedState == "published" {
		readiness, err = s.ReadinessForStore(ctx, result.Store)
		if err != nil {
			return postgres.PublicationResult{}, PublicationReadiness{}, err
		}
	}
	return result, readiness, nil
}

func evaluatePublicationGuard(ctx context.Context, requestedState string, store postgres.StoreRecord, readReadiness func(context.Context, postgres.StoreRecord) (PublicationReadiness, error)) (PublicationReadiness, error) {
	if requestedState != "published" {
		// Hiding must remain possible when Partner Identity, WLT, or catalog readiness is unavailable.
		return PublicationReadiness{}, nil
	}
	readiness, err := readReadiness(ctx, store)
	if err != nil {
		return readiness, err
	}
	if !readiness.Ready {
		return readiness, ErrPublicationReadinessBlocked
	}
	return readiness, nil
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
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return postgres.StoreFulfillmentModesResult{}, err
	}
	if strings.TrimSpace(store.PublicationState) == "published" {
		candidate := store
		candidate.FulfillmentModes = modes
		agreements, err := s.wlt.ReadStoreCommercialAgreements(ctx, store.ID)
		if err != nil {
			return postgres.StoreFulfillmentModesResult{}, err
		}
		// Durable mode law: a published Store's committed modes may only change when
		// the Partner owner has already accepted commercial terms covering exactly
		// the requested modes (an ACTIVE agreement, or a PARTNER_ACCEPTED version
		// awaiting Finance approval, which requires the committed modes to match).
		if !storeAgreementModesAccepted(candidate, agreements) {
			return postgres.StoreFulfillmentModesResult{}, ErrStoreFulfillmentAgreementRequired
		}
	}
	return postgres.SetStoreFulfillmentModes(ctx, s.db, storeID, actingActorID, modes, expectedVersion, idempotencyKey, correlationID)
}

func (s *Service) SetCommercialStoreType(ctx context.Context, input SetCommercialStoreTypeInput) (postgres.StoreCommercialTypeAssignmentResult, error) {
	actingActorID := strings.TrimSpace(input.ActingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.StoreCommercialTypeAssignmentResult{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.StoreCommercialTypeAssignmentResult{}, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.StoreCommercialTypeAssignmentResult{}, err
	}
	return postgres.SetStoreCommercialType(ctx, s.db, postgres.StoreCommercialTypeAssignmentInput{StoreID: input.StoreID, TypeID: input.TypeID, ActorID: actingActorID, Reason: input.Reason, CorrelationID: input.CorrelationID, IdempotencyKey: input.IdempotencyKey, ExpectedVersion: input.ExpectedVersion})
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
	if err := postgres.ReadStoreDisplayNames(ctx, s.db, &store); err != nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, err
	}
	readiness, err := s.ReadinessForStore(ctx, store)
	return store, readiness, err
}

// Partner store-presence belongs to the same active-operator Partners authorization
// boundary as the canonical store registry, independent of the caller's service token.
func (s *Service) ReadPartnerStorePresence(ctx context.Context, actingActorID string, actorIDs []string) ([]string, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	if actingActorID == "" || len(actingActorID) > 128 {
		return nil, postgres.ErrOperatorStoreInvalidActor
	}
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return nil, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return nil, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, actingActorID, "partners"); err != nil {
		return nil, err
	}
	return postgres.ReadPartnerStorePresence(ctx, s.db, actorIDs)
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
	state = strings.TrimSpace(state)
	if state == "published" {
		return []string{"partners", "marketing", "platform_policies"}
	}
	if state == "" {
		return []string{"partners", "catalog"}
	}
	return []string{"partners"}
}

// ListPublished paginates *eligible* Stores, not raw published rows. A Store
// may cease to be customer-visible when its owner loses eligibility or its
// commercial agreement becomes inactive, even though the persisted Store is
// still marked published.
func (s *Service) ListPublished(ctx context.Context, input postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
	return collectEligiblePublishedStores(ctx, input,
		func(ctx context.Context, query postgres.PublicStoreListQuery) (postgres.PublicStorePage, error) {
			return postgres.ListPublishedStorePage(ctx, s.db, query)
		},
		s.filterPublishedBatch,
	)
}

// collectEligiblePublishedStores advances the original query cursor over
// ineligible records so that a customer never receives a short/empty page
// merely because earlier published Stores failed Identity/WLT gates.
func collectEligiblePublishedStores(
	ctx context.Context,
	input postgres.PublicStoreListQuery,
	fetch func(context.Context, postgres.PublicStoreListQuery) (postgres.PublicStorePage, error),
	filter func(context.Context, postgres.PublicStorePage) (postgres.PublicStorePage, error),
) (postgres.PublicStorePage, error) {
	limit := input.Limit
	if limit == 0 {
		limit = 20
	}
	result := postgres.PublicStorePage{Stores: []postgres.PublicStoreRecord{}, Limit: limit}
	cursor := input.Cursor
	const maxRawRows = 200
	const maxFetchBatches = 20
	scannedRows := 0
	for batch := 0; batch < maxFetchBatches; batch++ {
		query := input
		query.Limit = min(limit-len(result.Stores), maxRawRows-scannedRows)
		query.Cursor = cursor
		raw, err := fetch(ctx, query)
		if err != nil {
			return postgres.PublicStorePage{}, err
		}
		eligible, err := filter(ctx, raw)
		if err != nil {
			return postgres.PublicStorePage{}, err
		}
		scannedRows += len(raw.Stores)
		result.Stores = append(result.Stores, eligible.Stores...)
		result.NextCursor = raw.NextCursor
		if raw.NextCursor != "" && raw.NextCursor == cursor {
			return postgres.PublicStorePage{}, errors.New("published Store cursor did not advance")
		}
		if len(result.Stores) >= limit || raw.NextCursor == "" || scannedRows >= maxRawRows || batch+1 >= maxFetchBatches {
			return result, nil
		}
		cursor = raw.NextCursor
	}
	return result, nil
}

func (s *Service) filterPublishedBatch(ctx context.Context, page postgres.PublicStorePage) (postgres.PublicStorePage, error) {
	if len(page.Stores) == 0 {
		return page, nil
	}
	actorIDs := make([]string, 0, len(page.Stores))
	seenActorIDs := make(map[string]struct{}, len(page.Stores))
	for _, store := range page.Stores {
		actorID := strings.TrimSpace(store.PartnerActorID)
		if actorID == "" {
			continue
		}
		if _, exists := seenActorIDs[actorID]; exists {
			continue
		}
		seenActorIDs[actorID] = struct{}{}
		actorIDs = append(actorIDs, actorID)
	}
	if len(actorIDs) == 0 {
		page.Stores = []postgres.PublicStoreRecord{}
		return page, nil
	}
	roles, err := s.identity.ReadActorRoles(ctx, "partner", actorIDs)
	if err != nil {
		return postgres.PublicStorePage{}, fmt.Errorf("%w: %w", ErrPartnerIdentityUnavailable, err)
	}
	eligibleRoles := make(map[string]identityclient.ActorRoleView, len(roles.Items))
	for _, role := range roles.Items {
		eligibleRoles[role.ActorID] = role
	}
	visible := make([]postgres.PublicStoreRecord, 0, len(page.Stores))
	for _, store := range page.Stores {
		role, exists := eligibleRoles[store.PartnerActorID]
		if !exists || !evaluatePartnerReadiness(role).Ready {
			continue
		}
		agreementReady, agreementErr := s.activeCommercialAgreementForStore(ctx, store.ID)
		if agreementErr != nil {
			return postgres.PublicStorePage{}, agreementErr
		}
		if agreementReady {
			visible = append(visible, store)
		}
	}
	page.Stores = visible
	return page, nil
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
	agreementReady, err := s.activeCommercialAgreementForStore(ctx, store.ID)
	if err != nil {
		return postgres.PublicStoreRecord{}, err
	}
	if !agreementReady {
		return postgres.PublicStoreRecord{}, postgres.ErrStoreNotFound
	}
	return store, nil
}

func (s *Service) ReadinessForStore(ctx context.Context, store postgres.StoreRecord) (PublicationReadiness, error) {
	// One canonical list for Store file, publication guard, and operator actionability.
	// Each independent requirement is read from its existing owning service.
	var missing []string
	if strings.TrimSpace(store.ServiceCityID) == "" {
		missing = append(missing, ServiceCityNotEligibleReason)
	} else {
		city, err := postgres.ReadServiceCity(ctx, s.db, store.ServiceCityID)
		if errors.Is(err, postgres.ErrServiceCityNotFound) {
			missing = append(missing, ServiceCityNotEligibleReason)
		} else if err != nil {
			return PublicationReadiness{}, err
		} else if !city.Active {
			missing = append(missing, ServiceCityNotEligibleReason)
		}
	}
	availability, err := postgres.ReadStoreOperationalAvailability(ctx, s.db, store.ID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if availability.ScheduleMode == "WEEKLY" && len(availability.WeeklySchedule) == 0 {
		missing = append(missing, StoreScheduleNotReadyReason)
	}
	logo, err := postgres.ReadStoreProfileMedia(ctx, s.db, "", store.ID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if logo == nil {
		missing = append(missing, StoreLogoNotReadyReason)
	}
	cover, err := postgres.ReadStoreCoverMedia(ctx, s.db, "", store.ID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if cover == nil {
		missing = append(missing, StoreCoverNotReadyReason)
	}
	catalogReady, err := postgres.HasPublishableCatalog(ctx, s.db, store.ID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if !catalogReady {
		missing = append(missing, CatalogNotReadyReason)
	}
	partner, err := s.ReadinessForPartner(ctx, store.PartnerActorID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if !partner.Ready {
		missing = append(missing, partner.BlockedReason)
	}
	agreementReady, err := s.activeCommercialAgreementForStore(ctx, store.ID)
	if err != nil {
		return PublicationReadiness{}, err
	}
	if !agreementReady {
		missing = append(missing, CommercialAgreementNotReadyReason)
	}
	if len(missing) > 0 {
		return PublicationReadiness{BlockedReason: missing[0], BlockedReasons: missing}, nil
	}
	return PublicationReadiness{Ready: true, BlockedReasons: []string{}}, nil
}

func (s *Service) activeCommercialAgreementForStore(ctx context.Context, storeID string) (bool, error) {
	store, err := postgres.ReadStore(ctx, s.db, strings.TrimSpace(storeID))
	if err != nil {
		return false, fmt.Errorf("read store commercial agreement facts: %w", err)
	}
	agreements, err := s.wlt.ReadStoreCommercialAgreements(ctx, store.ID)
	if err != nil {
		return false, fmt.Errorf("read store commercial agreement readiness: %w", err)
	}
	return activeStoreAgreementMatches(store, agreements), nil
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
	return PublicationReadiness{BlockedReason: reason, BlockedReasons: []string{reason}}
}

func evaluatePartnerReadiness(partner identityclient.ActorRoleView) PublicationReadiness {
	if partner.Role != "partner" || !partner.Enabled || !partner.SecurityEnabled || partner.ActivatedAt == nil {
		return blockedReadiness(PartnerIdentityNotEligibleReason)
	}
	return PublicationReadiness{Ready: true}
}
