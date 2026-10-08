package joiningcase

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"math"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrOperatorNotActive                = errors.New("operator actor is not active")
	ErrPartnerSessionForbidden          = errors.New("an active app-partner session is required")
	ErrPartnerIdentityUnavailable       = errors.New("partner identity admission is unavailable")
	ErrPartnerFinancialTermsPolicyStale = errors.New("partner financial terms policy changed after it was read")
	ErrInvalidInput                     = errors.New("joining case input is invalid")
)

type Service struct {
	identity     *identityintegration.Client
	db           *sql.DB
	wlt          *wlt.Client
	media        media.Store
	evidenceKeys *postgres.JoiningCaseEvidenceKeyring
}

func New(identity *identityintegration.Client, db *sql.DB, wltClient *wlt.Client, mediaStore media.Store, evidenceKeys *postgres.JoiningCaseEvidenceKeyring) (*Service, error) {
	if identity == nil || db == nil || wltClient == nil || mediaStore == nil || evidenceKeys == nil {
		return nil, errors.New("joining case configuration is invalid")
	}
	return &Service{identity: identity, db: db, wlt: wltClient, media: mediaStore, evidenceKeys: evidenceKeys}, nil
}

func (s *Service) Create(ctx context.Context, input contract.CreateJoiningCaseRequest, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	request, err := NormalizeCreateRequest(input)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	activeProvider, providerErr := postgres.IsActiveWalletProvider(ctx, s.db, request.WalletProviderKey)
	if providerErr != nil {
		return postgres.JoiningCaseResult{}, providerErr
	}
	if !activeProvider {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	requestHash, err := HashCreateRequest(s.evidenceKeys, "control-panel-joining-case-create", actingActorID, request)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.CreateJoiningCase(ctx, s.db, postgres.CreateJoiningCaseInput{IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: requestHash, ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), EvidenceKeyring: s.evidenceKeys, Request: request})
}

func validJoiningCaseProofType(value string) bool {
	switch value {
	case "COMMERCIAL_REGISTRATION", "IDENTITY_DOCUMENT", "FREELANCE_WORK_DOCUMENT":
		return true
	default:
		return false
	}
}

func (s *Service) Submit(ctx context.Context, caseID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	current, err := postgres.ReadJoiningCase(ctx, s.db, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	canAdmit := (current.Case.Origin == "control_panel" && current.Case.State == "draft") || (current.Case.Origin == "field" && current.Case.State == "admission_requested")
	if !canAdmit {
		if current.Case.State != "submitted" {
			return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
		}
		if current.Case.PartnerActorID == "" {
			return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
		}
		return postgres.SubmitJoiningCase(ctx, s.db, caseID, current.Case.PartnerActorID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseSubmit(caseID, current.Case.PartnerActorID, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	}
	if err := postgres.ValidateJoiningCaseSubmissionReadiness(current.Case, expectedVersion); err != nil {
		return postgres.JoiningCaseResult{}, err
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

func (s *Service) Review(ctx context.Context, caseID, decision, correctionReason, expectedTermsPolicyVersion string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
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
	period := ""
	policyVersion := ""
	if decision == "approved" {
		expectedTermsPolicyVersion = strings.TrimSpace(expectedTermsPolicyVersion)
		if expectedTermsPolicyVersion == "" || len(expectedTermsPolicyVersion) > 128 {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
		if err := s.identity.RequireOperatorPermission(ctx, strings.TrimSpace(actingActorID), "finance"); err != nil {
			return postgres.JoiningCaseResult{}, err
		}
		policy, err := s.wlt.ReadPartnerFinancialTermsPolicy(ctx)
		if err != nil {
			return postgres.JoiningCaseResult{}, err
		}
		period = strings.ToUpper(strings.TrimSpace(policy.SettlementPeriod))
		policyVersion = strings.TrimSpace(policy.PolicyVersion)
		if policyVersion != expectedTermsPolicyVersion {
			return postgres.JoiningCaseResult{}, ErrPartnerFinancialTermsPolicyStale
		}
		if (period != "DAILY" && period != "WEEKLY" && period != "MONTHLY") || len(policyVersion) > 128 || !strings.HasPrefix(policyVersion, "partner-financial-terms:v") {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
	}
	review := postgres.ReviewJoiningCaseInput{CaseID: caseID, Decision: decision, CorrectionReason: correctionReason, SettlementPeriod: period, TermsPolicyVersion: policyVersion, ExpectedVersion: expectedVersion, IdempotencyKey: strings.TrimSpace(idempotencyKey), ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID)}
	review.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(caseID, decision, correctionReason, expectedVersion, period, policyVersion)
	result, err := postgres.ReviewJoiningCase(ctx, s.db, review)
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

func (s *Service) BindFinancialTerms(ctx context.Context, caseID, expectedTermsPolicyVersion string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if err := s.identity.RequireOperatorPermission(ctx, strings.TrimSpace(actingActorID), "finance"); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	policy, err := s.wlt.ReadPartnerFinancialTermsPolicy(ctx)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	expectedTermsPolicyVersion = strings.TrimSpace(expectedTermsPolicyVersion)
	if expectedTermsPolicyVersion == "" || len(expectedTermsPolicyVersion) > 128 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if strings.TrimSpace(policy.PolicyVersion) != expectedTermsPolicyVersion {
		return postgres.JoiningCaseResult{}, ErrPartnerFinancialTermsPolicyStale
	}
	if (policy.SettlementPeriod != "DAILY" && policy.SettlementPeriod != "WEEKLY" && policy.SettlementPeriod != "MONTHLY") || len(strings.TrimSpace(policy.PolicyVersion)) > 128 || !strings.HasPrefix(strings.TrimSpace(policy.PolicyVersion), "partner-financial-terms:v") {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	caseID = strings.TrimSpace(caseID)
	policyVersion := strings.TrimSpace(policy.PolicyVersion)
	requestHash := postgres.HashJoiningCaseReviewWithFinancialTerms(caseID, "bind-financial-terms", "", expectedVersion, policy.SettlementPeriod, policyVersion)
	result, err := postgres.BindApprovedJoiningCaseFinancialTerms(ctx, s.db, postgres.BindJoiningCaseFinancialTermsInput{CaseID: caseID, SettlementPeriod: strings.ToUpper(policy.SettlementPeriod), TermsPolicyVersion: policyVersion, ExpectedVersion: expectedVersion, IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: requestHash, ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID)})
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if result.Case.FinancialProfileState != "ACTIVE" {
		if err := s.syncFinancialProfile(ctx, result.Case.ID); err != nil {
			return result, err
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
		prepared, _, err := s.wlt.PreparePartnerFinancialProfile(ctx, wlt.PreparePartnerFinancialProfileInput{JoiningCaseID: item.CaseID, PartnerActorID: item.PartnerActorID, Origin: item.Origin, SettlementPeriod: item.SettlementPeriod, TermsPolicyVersion: item.TermsPolicyVersion, IdempotencyKey: item.IdempotencyKey, CorrelationID: item.CorrelationID})
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

func (s *Service) ReadForOperatorByPartnerActor(ctx context.Context, actorID, actingActorID string) (postgres.JoiningCaseResult, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || len(actorID) > 128 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.ReadJoiningCaseForPartner(ctx, s.db, actorID)
}

func (s *Service) ListStoresForOperatorByPartnerActor(ctx context.Context, actorID, actingActorID string, limit int, cursor string) (postgres.PartnerStorePage, error) {
	actorID = strings.TrimSpace(actorID)
	cursor = strings.TrimSpace(cursor)
	if actorID == "" || len(actorID) > 128 || len(cursor) > 128 || limit < 1 || limit > 50 {
		return postgres.PartnerStorePage{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.PartnerStorePage{}, err
	}
	role, err := s.identity.ReadActorRole(ctx, actorID, "partner")
	if err != nil {
		return postgres.PartnerStorePage{}, err
	}
	if role.Role != "partner" {
		return postgres.PartnerStorePage{}, ErrPartnerIdentityUnavailable
	}
	page, err := postgres.ListStoresForPartnerActor(ctx, s.db, actorID, limit, cursor)
	if err != nil {
		return postgres.PartnerStorePage{}, err
	}
	for index := range page.Stores {
		if err := postgres.ReadStoreDisplayNames(ctx, s.db, &page.Stores[index]); err != nil {
			return postgres.PartnerStorePage{}, err
		}
	}
	return page, nil
}

func (s *Service) CorrectAndResubmitForPartner(ctx context.Context, accessToken, caseID string, input contract.CorrectJoiningCaseRequest, expectedVersion int, idempotencyKey, correlationID string) (postgres.JoiningCaseResult, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID = strings.TrimSpace(caseID)
	ownerFullName := strings.TrimSpace(input.OwnerFullName)
	businessName := strings.TrimSpace(input.BusinessName)
	firstStoreName := strings.TrimSpace(input.FirstStoreName)
	firstStoreAddress := strings.TrimSpace(input.FirstStoreAddress)
	proofType := strings.TrimSpace(string(input.FirstStoreProofType))
	proofNumber := strings.TrimSpace(input.FirstStoreProofNumber)
	notes := strings.TrimSpace(input.FirstStoreNotes)
	serviceCityID := strings.TrimSpace(input.ServiceCityID)
	verticalID := strings.TrimSpace(input.FirstStoreVerticalID)
	commercialTypeID := strings.TrimSpace(input.FirstStoreCommercialTypeID)
	latitude := input.FirstStoreLatitude
	longitude := input.FirstStoreLongitude
	workingHours, hoursErr := json.Marshal(input.FirstStoreWorkingHours)
	if caseID == "" || hoursErr != nil || !postgres.ValidateStoreWorkingHours(workingHours) || len([]rune(ownerFullName)) < 2 || len([]rune(ownerFullName)) > 160 || len([]rune(businessName)) < 2 || len([]rune(businessName)) > 160 || len([]rune(firstStoreName)) < 2 || len([]rune(firstStoreName)) > 160 || len([]rune(firstStoreAddress)) < 4 || len([]rune(firstStoreAddress)) > 500 || !validJoiningCaseProofNumber(proofNumber) || len([]rune(notes)) > 1000 || !validJoiningCaseProofType(proofType) || serviceCityID == "" || verticalID == "" || commercialTypeID == "" || expectedVersion < 1 || !validCoordinates(latitude, longitude) || len(input.FirstStoreFulfillmentModes) == 0 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	rawModes := make([]string, len(input.FirstStoreFulfillmentModes))
	for index, mode := range input.FirstStoreFulfillmentModes {
		rawModes[index] = string(mode)
	}
	fulfillmentModes, modesErr := postgres.NormalizeStoreFulfillmentModes(rawModes)
	if modesErr != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	mutation := postgres.CorrectJoiningCaseInput{CaseID: caseID, ActorID: identity.Subject, OwnerFullName: ownerFullName, BusinessName: businessName, FirstStoreName: firstStoreName, FirstStoreAddress: firstStoreAddress, FirstStoreWorkingHours: workingHours, FirstStoreProofType: proofType, FirstStoreProofNumber: proofNumber, FirstStoreNotes: notes, EvidenceKeyring: s.evidenceKeys, ExpectedVersion: expectedVersion, IdempotencyKey: strings.TrimSpace(idempotencyKey), CorrelationID: strings.TrimSpace(correlationID), ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: commercialTypeID, Latitude: latitude, Longitude: longitude, FulfillmentModes: fulfillmentModes}
	requestHash, err := s.evidenceKeys.RequestHash("partner-correct-and-resubmit", caseID, identity.Subject, ownerFullName, businessName, firstStoreName, firstStoreAddress, string(workingHours), proofType, proofNumber, notes, serviceCityID, verticalID, commercialTypeID, strconv.FormatFloat(latitude, 'f', 6, 64), strconv.FormatFloat(longitude, 'f', 6, 64), strings.Join(fulfillmentModes, ","), strconv.Itoa(expectedVersion))
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	mutation.RequestHash = requestHash
	return postgres.CorrectAndResubmitJoiningCase(ctx, s.db, mutation)
}

func (s *Service) UploadProofImageForPartner(ctx context.Context, accessToken, caseID, idempotencyKey, correlationID string, expectedVersion int, declaredContentType string, data []byte) (postgres.JoiningCaseResult, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return UploadPrivateProofImage(ctx, s.db, s.evidenceKeys, caseID, identity.Subject, "partner", "partner-proof-image-upload", idempotencyKey, correlationID, expectedVersion, declaredContentType, data)
}

func (s *Service) UploadProofImageForOperator(ctx context.Context, caseID, actingActorID, idempotencyKey, correlationID string, expectedVersion int, declaredContentType string, data []byte) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	actingActorID = strings.TrimSpace(actingActorID)
	return UploadPrivateProofImage(ctx, s.db, s.evidenceKeys, caseID, actingActorID, "operator", "operator-proof-image-upload", idempotencyKey, correlationID, expectedVersion, declaredContentType, data)
}

func (s *Service) ReadProofDetailsForOperator(ctx context.Context, caseID, actingActorID, correlationID string) (postgres.JoiningCaseProofDetails, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseProofDetails{}, err
	}
	return postgres.ReadJoiningCaseProofDetailsForOperator(ctx, s.db, caseID, actingActorID, correlationID, s.evidenceKeys)
}

func (s *Service) DownloadProofImageForOperator(ctx context.Context, caseID, actingActorID, correlationID string) (postgres.JoiningCaseProofImage, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseProofImage{}, err
	}
	return postgres.ReadJoiningCaseProofImageForOperator(ctx, s.db, caseID, actingActorID, correlationID, s.evidenceKeys)
}

func validCoordinates(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsInf(latitude, 0) && !math.IsNaN(longitude) && !math.IsInf(longitude, 0) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

func (s *Service) ListForOperator(ctx context.Context, state, query, sort string, limit int, cursor, actingActorID string) (postgres.JoiningCaseListResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseListResult{}, err
	}
	return postgres.ListJoiningCases(ctx, s.db, state, query, sort, limit, cursor)
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
	return s.identity.RequireOperatorPermission(ctx, strings.TrimSpace(actorID), "partners")
}
