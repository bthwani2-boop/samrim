package joiningcase

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"math"
	"regexp"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrOperatorNotActive          = errors.New("operator actor is not active")
	ErrPartnerSessionForbidden    = errors.New("an active app-partner session is required")
	ErrPartnerIdentityUnavailable = errors.New("partner identity admission is unavailable")
	ErrInvalidInput               = errors.New("joining case input is invalid")
	ErrServiceCityUnavailable     = errors.New("an active service city is required")
)

var phoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	wlt      *wlt.Client
}

func New(identity *identityintegration.Client, db *sql.DB, wltClient *wlt.Client) (*Service, error) {
	if identity == nil || db == nil || wltClient == nil {
		return nil, errors.New("joining case configuration is invalid")
	}
	return &Service{identity: identity, db: db, wlt: wltClient}, nil
}

func (s *Service) Create(ctx context.Context, input postgres.JoiningCaseRecord, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	phone := strings.TrimSpace(input.ContactPhoneE164)
	businessName := strings.TrimSpace(input.BusinessName)
	firstStoreName := strings.TrimSpace(input.FirstStoreName)
	serviceCityID := strings.TrimSpace(input.FirstStoreServiceCityID)
	verticalID := strings.TrimSpace(input.FirstStoreVerticalID)
	fulfillmentModes, modesErr := postgres.NormalizeStoreFulfillmentModes(input.FirstStoreFulfillmentModes)
	if modesErr != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if !phoneE164Pattern.MatchString(phone) || len(businessName) < 2 || len(businessName) > 160 || len(firstStoreName) < 2 || len(firstStoreName) > 160 || serviceCityID == "" || verticalID == "" || input.FirstStoreLatitude == nil || input.FirstStoreLongitude == nil || !validCoordinates(*input.FirstStoreLatitude, *input.FirstStoreLongitude) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	city, err := postgres.ReadServiceCity(ctx, s.db, serviceCityID)
	if err != nil || !city.Active {
		return postgres.JoiningCaseResult{}, ErrServiceCityUnavailable
	}
	vertical, err := postgres.ReadCommerceVertical(ctx, s.db, verticalID)
	if err != nil || !vertical.Active {
		return postgres.JoiningCaseResult{}, postgres.ErrCatalogVerticalNotFound
	}
	return postgres.CreateJoiningCase(ctx, s.db, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseRequest(phone, businessName, firstStoreName, serviceCityID, verticalID, *input.FirstStoreLatitude, *input.FirstStoreLongitude, fulfillmentModes), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID), phone, businessName, firstStoreName, serviceCityID, verticalID, *input.FirstStoreLatitude, *input.FirstStoreLongitude, fulfillmentModes)
}

func (s *Service) Submit(ctx context.Context, caseID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	current, err := postgres.ReadJoiningCase(ctx, s.db, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if current.Case.Origin != "control_panel" {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
	}
	if current.Case.State != "draft" {
		if current.Case.PartnerActorID == "" {
			return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
		}
		return postgres.SubmitJoiningCase(ctx, s.db, caseID, current.Case.PartnerActorID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseSubmit(caseID, current.Case.PartnerActorID, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	}
	if current.Case.Version != expectedVersion {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseVersion
	}
	actorRole, err := s.identity.ProvisionPartnerWithContext(ctx, identityintegration.ActorInput{PhoneE164: current.Case.ContactPhoneE164}, correlationID, actingActorID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if actorRole.Role != "partner" || strings.TrimSpace(actorRole.ActorID) == "" {
		return postgres.JoiningCaseResult{}, ErrPartnerIdentityUnavailable
	}
	return postgres.SubmitJoiningCase(ctx, s.db, caseID, actorRole.ActorID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseSubmit(caseID, actorRole.ActorID, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) Review(ctx context.Context, caseID, decision, correctionReason string, commissionRateBps *int, settlementPeriod *string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	decision = strings.ToLower(strings.TrimSpace(decision))
	correctionReason = strings.TrimSpace(correctionReason)
	if decision != "approved" && decision != "needs_correction" {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseInvalidDecision
	}
	if decision == "needs_correction" && (len(correctionReason) < 5 || len(correctionReason) > 500) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	commission := 0
	period := ""
	if decision == "approved" {
		if commissionRateBps == nil || settlementPeriod == nil {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
		commission = *commissionRateBps
		period = strings.ToUpper(strings.TrimSpace(*settlementPeriod))
		if commission < 0 || commission > 10000 || (period != "DAILY" && period != "WEEKLY" && period != "MONTHLY") {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
	}
	result, err := postgres.ReviewJoiningCase(ctx, s.db, caseID, decision, correctionReason, commission, period, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseReviewWithFinancialTerms(caseID, decision, correctionReason, expectedVersion, commission, period), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if decision == "approved" && result.Case.FinancialProfileState != "ACTIVE" {
		if syncErr := s.syncFinancialProfile(ctx, result.Case.ID); syncErr != nil {
			log.Printf("joining case financial profile binding failed case=%s: %v", result.Case.ID, syncErr)
			return result, syncErr
		}
		return postgres.ReadJoiningCase(ctx, s.db, result.Case.ID)
	}
	return result, nil
}

func (s *Service) ReconcileFinancialProfiles(ctx context.Context, limit int) error {
	items, err := postgres.ListPendingFinancialProfileBindings(ctx, s.db, limit)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := s.syncFinancialProfileItem(ctx, item); err != nil {
			if markErr := postgres.MarkFinancialProfileBindingFailure(ctx, s.db, item.ID, err.Error()); markErr != nil {
				return markErr
			}
		}
	}
	return nil
}

func (s *Service) syncFinancialProfile(ctx context.Context, caseID string) error {
	item, err := postgres.ReadPendingFinancialProfileBinding(ctx, s.db, caseID)
	if err != nil {
		return err
	}
	return s.syncFinancialProfileItem(ctx, item)
}

func (s *Service) syncFinancialProfileItem(ctx context.Context, item postgres.PendingFinancialProfileBinding) error {
	profileID := strings.TrimSpace(item.FinancialProfileID)
	var profile wlt.PartnerFinancialProfile
	if profileID == "" {
		prepared, _, err := s.wlt.PreparePartnerFinancialProfile(ctx, item.CaseID, item.PartnerActorID, item.Origin, item.CommissionRateBps, item.SettlementPeriod, item.IdempotencyKey, item.CorrelationID)
		if err != nil {
			return err
		}
		profile = prepared
		profileID = prepared.ID
		if err := postgres.MarkFinancialProfilePrepared(ctx, s.db, item.CaseID, item.ID, profileID); err != nil {
			return err
		}
	} else {
		read, err := s.wlt.ReadPartnerFinancialProfile(ctx, profileID)
		if err != nil {
			return err
		}
		profile = read
	}
	if profile.State == "ACTIVE" {
		return postgres.MarkFinancialProfileActive(ctx, s.db, item.CaseID, item.ID)
	}
	if profile.State != "PENDING_BINDING" {
		return errors.New("WLT financial profile is not activatable")
	}
	activated, _, err := s.wlt.ActivatePartnerFinancialProfile(ctx, profile.ID, profile.Version, wlt.DerivedIdempotencyKey("financial-profile-activate", item.IdempotencyKey), item.CorrelationID, item.ActingActorID)
	if err != nil {
		var wltErr *wlt.Error
		if errors.As(err, &wltErr) && wltErr.Code == "VERSION_CONFLICT" {
			read, readErr := s.wlt.ReadPartnerFinancialProfile(ctx, profile.ID)
			if readErr == nil && read.State == "ACTIVE" {
				return postgres.MarkFinancialProfileActive(ctx, s.db, item.CaseID, item.ID)
			}
		}
		return err
	}
	if activated.State != "ACTIVE" {
		return errors.New("WLT financial profile activation did not reach ACTIVE")
	}
	return postgres.MarkFinancialProfileActive(ctx, s.db, item.CaseID, item.ID)
}

func (s *Service) ReadForOperator(ctx context.Context, caseID, actingActorID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.ReadJoiningCase(ctx, s.db, caseID)
}

func (s *Service) ReadForPartner(ctx context.Context, accessToken string) (postgres.JoiningCaseResult, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.ReadJoiningCaseForPartner(ctx, s.db, identity.Subject)
}

func (s *Service) CorrectAndResubmitForPartner(ctx context.Context, accessToken, caseID, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64, fulfillmentModes []string, expectedVersion int, idempotencyKey, correlationID string) (postgres.JoiningCaseResult, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID = strings.TrimSpace(caseID)
	businessName = strings.TrimSpace(businessName)
	firstStoreName = strings.TrimSpace(firstStoreName)
	serviceCityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	normalizedModes, modesErr := postgres.NormalizeStoreFulfillmentModes(fulfillmentModes)
	if modesErr != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if caseID == "" || len(businessName) < 2 || len(businessName) > 160 || len(firstStoreName) < 2 || len(firstStoreName) > 160 || serviceCityID == "" || verticalID == "" || expectedVersion < 1 || !validCoordinates(latitude, longitude) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	city, err := postgres.ReadServiceCity(ctx, s.db, serviceCityID)
	if err != nil || !city.Active {
		return postgres.JoiningCaseResult{}, ErrServiceCityUnavailable
	}
	vertical, err := postgres.ReadCommerceVertical(ctx, s.db, verticalID)
	if err != nil || !vertical.Active {
		return postgres.JoiningCaseResult{}, postgres.ErrCatalogVerticalNotFound
	}
	return postgres.CorrectAndResubmitJoiningCase(ctx, s.db, caseID, identity.Subject, businessName, firstStoreName, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseCorrectAndResubmit(caseID, identity.Subject, businessName, firstStoreName, expectedVersion, serviceCityID, verticalID, latitude, longitude, normalizedModes), strings.TrimSpace(correlationID), serviceCityID, verticalID, latitude, longitude, normalizedModes)
}

func validCoordinates(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsInf(latitude, 0) && !math.IsNaN(longitude) && !math.IsInf(longitude, 0) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

func (s *Service) ListForOperator(ctx context.Context, state string, limit int, cursor, actingActorID string) (postgres.JoiningCaseListResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseListResult{}, err
	}
	return postgres.ListJoiningCases(ctx, s.db, state, limit, cursor)
}

func (s *Service) requirePartner(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrPartnerSessionForbidden
	}
	return identity, nil
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}
