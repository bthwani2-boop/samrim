package joiningcase

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrStoreAgreementInvalidInput = errors.New("Store commercial agreement input is invalid")
	ErrStoreAgreementState        = errors.New("Store commercial agreement is not in the required state")
	ErrStoreAgreementForbidden    = errors.New("Store commercial agreement action is not authorized")
)

type StoreCommercialAgreementProposalInput struct {
	Rates                  []wltintegration.StoreCommercialAgreementRate
	ExpectedCurrentVersion int
	Reason                 string
}

func (s *Service) ReadStoreCommercialAgreementsForField(ctx context.Context, accessToken, caseID string) ([]wltintegration.StoreCommercialAgreement, error) {
	fieldIdentity, err := s.requireField(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if err := s.requireEligibleFieldActor(ctx, fieldIdentity.Subject); err != nil {
		return nil, err
	}
	joiningCase, err := postgres.ReadJoiningCaseForField(ctx, s.db, fieldIdentity.Subject, strings.TrimSpace(caseID))
	if err != nil {
		return nil, err
	}
	if joiningCase.Case.StoreID == "" {
		return []wltintegration.StoreCommercialAgreement{}, nil
	}
	return s.wlt.ReadStoreCommercialAgreements(ctx, joiningCase.Case.StoreID)
}

func (s *Service) ProposeStoreCommercialAgreementForField(ctx context.Context, accessToken, caseID string, input StoreCommercialAgreementProposalInput, idempotencyKey, correlationID string) (wltintegration.StoreCommercialAgreement, bool, error) {
	fieldIdentity, err := s.requireField(ctx, accessToken)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	if err := s.requireEligibleFieldActor(ctx, fieldIdentity.Subject); err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	caseID = strings.TrimSpace(caseID)
	if caseID == "" || !validStoreAgreementMutationHeaders(idempotencyKey, correlationID) || !validStoreAgreementReason(input.Reason) || input.ExpectedCurrentVersion < 0 {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementInvalidInput
	}
	joiningCase, err := postgres.ReadJoiningCaseForField(ctx, s.db, fieldIdentity.Subject, caseID)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	current := joiningCase.Case
	if current.Origin != "field" || current.OriginatingFieldActorID != fieldIdentity.Subject || current.State != "approved" || current.Store == nil || current.Store.ID == "" || current.PartnerActorID == "" || current.Store.PartnerActorID != current.PartnerActorID {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementState
	}
	if !fieldMayProposeStoreAgreement(current.Store.PublicationState) {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementState
	}
	rates, err := normalizeStoreAgreementRates(current.Store.FulfillmentModes, input.Rates)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementInvalidInput
	}
	// WLT owns agreement history, pending-state and version checks, plus replay.
	agreement, replayed, err := s.wlt.ProposeStoreCommercialAgreement(ctx, wltintegration.ProposeStoreCommercialAgreementInput{
		StoreID: current.Store.ID, PartnerActorID: current.PartnerActorID, Rates: rates,
		ExpectedCurrentVersion: input.ExpectedCurrentVersion, Reason: input.Reason,
	}, strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID), fieldIdentity.Subject)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	if agreement.StoreID != current.Store.ID || agreement.PartnerActorID != current.PartnerActorID || agreement.ProposedByActorID != fieldIdentity.Subject || agreement.Status != "PROPOSED" {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT agreement proposal readback did not match the assigned joining case")
	}
	return agreement, replayed, nil
}

func fieldMayProposeStoreAgreement(publicationState string) bool {
	return publicationState == "unpublished" || publicationState == "published"
}

func (s *Service) ReadStoreTypeCommissionDefaultsForField(ctx context.Context, accessToken, caseID string) (wltintegration.StoreTypeCommissionDefaultsResponse, error) {
	fieldIdentity, err := s.requireField(ctx, accessToken)
	if err != nil {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, err
	}
	if err := s.requireEligibleFieldActor(ctx, fieldIdentity.Subject); err != nil {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, err
	}
	joiningCase, err := postgres.ReadJoiningCaseForField(ctx, s.db, fieldIdentity.Subject, strings.TrimSpace(caseID))
	if err != nil {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, err
	}
	typeID := strings.TrimSpace(joiningCase.Case.FirstStoreCommercialTypeID)
	if typeID == "" {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, ErrStoreAgreementState
	}
	return s.wlt.ReadStoreTypeCommissionDefaults(ctx, typeID)
}

func (s *Service) ReadStoreTypeCommissionDefaultsForFinance(ctx context.Context, commercialStoreTypeID, actingActorID string) (wltintegration.StoreTypeCommissionDefaultsResponse, error) {
	if err := s.requireFinance(ctx, actingActorID); err != nil {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, err
	}
	commercialStoreTypeID = strings.TrimSpace(commercialStoreTypeID)
	if commercialStoreTypeID == "" || len(commercialStoreTypeID) > 128 {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, ErrStoreAgreementInvalidInput
	}
	if _, err := postgres.ReadCommercialStoreType(ctx, s.db, commercialStoreTypeID); err != nil {
		return wltintegration.StoreTypeCommissionDefaultsResponse{}, err
	}
	return s.wlt.ReadStoreTypeCommissionDefaults(ctx, commercialStoreTypeID)
}

func (s *Service) UpdateStoreTypeCommissionDefaultForFinance(ctx context.Context, commercialStoreTypeID, actingActorID, fulfillmentMode string, suggestedCommissionRateBps, expectedDefaultVersion int, reason, idempotencyKey, correlationID string) (wltintegration.StoreTypeCommissionDefaultUpdateResponse, error) {
	if err := s.requireFinance(ctx, actingActorID); err != nil {
		return wltintegration.StoreTypeCommissionDefaultUpdateResponse{}, err
	}
	commercialStoreTypeID = strings.TrimSpace(commercialStoreTypeID)
	if commercialStoreTypeID == "" || len(commercialStoreTypeID) > 128 {
		return wltintegration.StoreTypeCommissionDefaultUpdateResponse{}, ErrStoreAgreementInvalidInput
	}
	if _, err := postgres.ReadActiveCommercialStoreType(ctx, s.db, commercialStoreTypeID); err != nil {
		return wltintegration.StoreTypeCommissionDefaultUpdateResponse{}, err
	}
	return s.wlt.UpdateStoreTypeCommissionDefault(ctx, wltintegration.StoreTypeCommissionDefaultUpdateInput{
		CommercialStoreTypeID: commercialStoreTypeID,
		FulfillmentMode:       fulfillmentMode, SuggestedCommissionRateBps: suggestedCommissionRateBps,
		ExpectedDefaultVersion: expectedDefaultVersion, Reason: reason,
		IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingActorID,
	})
}

func (s *Service) ReadStoreCommercialAgreementsForPartner(ctx context.Context, accessToken, storeID string) ([]wltintegration.StoreCommercialAgreement, error) {
	partner, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	store, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, storeID, partner.Subject)
	if err != nil {
		return nil, err
	}
	agreements, err := s.wlt.ReadStoreCommercialAgreements(ctx, store.ID)
	if err != nil {
		return nil, err
	}
	return matchingPartnerStoreAgreements(agreements, store.ID, partner.Subject), nil
}

func (s *Service) AcceptStoreCommercialAgreementForPartner(ctx context.Context, accessToken, storeID, agreementID string, expectedAgreementVersion int, reason, idempotencyKey, correlationID string) (wltintegration.StoreCommercialAgreement, bool, error) {
	partner, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	storeID, agreementID = strings.TrimSpace(storeID), strings.TrimSpace(agreementID)
	if storeID == "" || len(storeID) > 128 || agreementID == "" || expectedAgreementVersion < 1 || !validStoreAgreementMutationHeaders(idempotencyKey, correlationID) || !validStoreAgreementReason(reason) {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementInvalidInput
	}
	store, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, storeID, partner.Subject)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	agreements, err := s.wlt.ReadStoreCommercialAgreements(ctx, store.ID)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	var selected *wltintegration.StoreCommercialAgreement
	for index := range agreements {
		item := &agreements[index]
		if item.AgreementID == strings.TrimSpace(agreementID) {
			selected = item
			break
		}
	}
	if selected == nil || selected.StoreID != store.ID || selected.PartnerActorID != partner.Subject {
		return wltintegration.StoreCommercialAgreement{}, false, postgres.ErrJoiningCaseNotFound
	}
	// WLT checks the transition and recognizes retries before checking status.
	agreement, replayed, err := s.wlt.AcceptStoreCommercialAgreement(ctx, selected.AgreementID, expectedAgreementVersion, reason, strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID), partner.Subject)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	if agreement.AgreementID != selected.AgreementID || agreement.StoreID != store.ID || agreement.PartnerActorID != partner.Subject || agreement.PartnerAcceptedByActorID == nil || *agreement.PartnerAcceptedByActorID != partner.Subject || !partnerAgreementAcceptanceStatusConfirmed(agreement.Status, replayed) {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT agreement acceptance readback did not match the Partner owner")
	}
	return agreement, replayed, nil
}

func partnerAgreementAcceptanceStatusConfirmed(status string, replayed bool) bool {
	switch status {
	case "PARTNER_ACCEPTED":
		return true
	case "ACTIVE", "FINANCE_REJECTED", "SUPERSEDED":
		return replayed
	default:
		return false
	}
}

func (s *Service) ReadStoreCommercialAgreementsForFinance(ctx context.Context, storeID, actingActorID string) ([]wltintegration.StoreCommercialAgreement, error) {
	if err := s.requireFinance(ctx, actingActorID); err != nil {
		return nil, err
	}
	storeID = strings.TrimSpace(storeID)
	if storeID == "" || len(storeID) > 128 {
		return nil, ErrStoreAgreementInvalidInput
	}
	if _, err := postgres.ReadStore(ctx, s.db, storeID); err != nil {
		return nil, err
	}
	agreements, err := s.wlt.ReadStoreCommercialAgreements(ctx, storeID)
	if err != nil {
		return nil, err
	}
	return agreements, nil
}

func (s *Service) DecideStoreCommercialAgreementForFinance(ctx context.Context, storeID, agreementID string, input wltintegration.StoreCommercialAgreementDecision, idempotencyKey, correlationID, actingActorID string) (wltintegration.StoreCommercialAgreement, bool, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	if err := s.requireFinance(ctx, actingActorID); err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	storeID, agreementID = strings.TrimSpace(storeID), strings.TrimSpace(agreementID)
	input.Decision = strings.ToUpper(strings.TrimSpace(input.Decision))
	if storeID == "" || agreementID == "" || input.AgreementVersion < 1 || (input.Decision != "APPROVE" && input.Decision != "REJECT") || !validStoreAgreementReason(input.Reason) || !validStoreAgreementMutationHeaders(idempotencyKey, correlationID) {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementInvalidInput
	}
	agreements, err := s.wlt.ReadStoreCommercialAgreements(ctx, storeID)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	var selected *wltintegration.StoreCommercialAgreement
	for index := range agreements {
		item := &agreements[index]
		if item.AgreementID == agreementID {
			selected = item
			break
		}
	}
	if selected == nil || selected.StoreID != storeID {
		return wltintegration.StoreCommercialAgreement{}, false, postgres.ErrStoreNotFound
	}
	if actingActorID == selected.PartnerActorID || actingActorID == selected.ProposedByActorID {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementForbidden
	}
	if input.Decision == "APPROVE" {
		currentStore, storeErr := postgres.ReadStore(ctx, s.db, storeID)
		if storeErr == nil {
			input.CurrentStorePartnerActorID = currentStore.PartnerActorID
			input.CurrentFulfillmentModes = currentStore.FulfillmentModes
		} else if !errors.Is(storeErr, postgres.ErrStoreNotFound) {
			return wltintegration.StoreCommercialAgreement{}, false, storeErr
		}
	}
	// Agreement status/version is checked by WLT after its idempotency lookup;
	// WLT checks current Store ownership/modes after replay and before a new approval.
	agreement, replayed, err := s.wlt.DecideStoreCommercialAgreement(ctx, agreementID, input, strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID), strings.TrimSpace(actingActorID))
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	if agreement.AgreementID != agreementID || agreement.StoreID != storeID || agreement.PartnerActorID != selected.PartnerActorID {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT agreement decision readback did not match the Store")
	}
	wantStatus := "ACTIVE"
	if input.Decision == "REJECT" {
		wantStatus = "FINANCE_REJECTED"
	}
	if agreement.Status != wantStatus {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT agreement decision did not reach its requested state")
	}
	if agreement.AgreementVersion != input.AgreementVersion || agreement.FinanceDecisionByActorID == nil || strings.TrimSpace(*agreement.FinanceDecisionByActorID) != actingActorID || agreement.FinanceDecisionReason == nil || strings.TrimSpace(*agreement.FinanceDecisionReason) != strings.TrimSpace(input.Reason) || !validStoreAgreementDecisionTime(agreement.FinanceDecisionAt) {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT finance decision readback did not match the authorized operator and reason")
	}
	if input.Decision == "APPROVE" && (agreement.FinanceApprovedByActorID == nil || strings.TrimSpace(*agreement.FinanceApprovedByActorID) != actingActorID || !validStoreAgreementDecisionTime(agreement.FinanceApprovedAt) || !validStoreAgreementDecisionTime(agreement.EffectiveAt)) {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT finance approval readback is incomplete")
	}
	return agreement, replayed, nil
}

func validStoreAgreementDecisionTime(value *string) bool {
	if value == nil || strings.TrimSpace(*value) == "" {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*value))
	return err == nil
}

func (s *Service) requireFinance(ctx context.Context, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || len(actorID) > 128 {
		return ErrStoreAgreementForbidden
	}
	operator, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return s.identity.RequireOperatorPermission(ctx, actorID, "finance")
}

func (s *Service) requireField(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "field" || identity.Surface != "app-field" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrFieldSessionForbidden
	}
	return identity, nil
}

func (s *Service) requireEligibleFieldActor(ctx context.Context, actorID string) error {
	admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, strings.TrimSpace(actorID))
	if err != nil {
		return err
	}
	if admission.State != "eligible" || admission.RequiresProfileReview || admission.FullNameAr == "" {
		return ErrFieldSessionForbidden
	}
	return nil
}

func normalizeStoreAgreementRates(storeModes []string, rates []wltintegration.StoreCommercialAgreementRate) ([]wltintegration.StoreCommercialAgreementRate, error) {
	modes, err := postgres.NormalizeStoreFulfillmentModes(storeModes)
	if err != nil || len(modes) == 0 || len(rates) != len(modes) {
		return nil, ErrStoreAgreementInvalidInput
	}
	byMode := make(map[string]int, len(rates))
	for _, rate := range rates {
		mode := strings.ToUpper(strings.TrimSpace(rate.FulfillmentMode))
		if !isSupportedStoreAgreementMode(mode) || rate.CommissionRateBps < 0 || rate.CommissionRateBps > 10000 {
			return nil, ErrStoreAgreementInvalidInput
		}
		if _, exists := byMode[mode]; exists {
			return nil, ErrStoreAgreementInvalidInput
		}
		byMode[mode] = rate.CommissionRateBps
	}
	result := make([]wltintegration.StoreCommercialAgreementRate, 0, len(modes))
	for _, mode := range modes {
		rate, exists := byMode[mode]
		if !exists {
			return nil, ErrStoreAgreementInvalidInput
		}
		result = append(result, wltintegration.StoreCommercialAgreementRate{FulfillmentMode: mode, CommissionRateBps: rate})
	}
	return result, nil
}

func matchingPartnerStoreAgreements(agreements []wltintegration.StoreCommercialAgreement, storeID, partnerActorID string) []wltintegration.StoreCommercialAgreement {
	result := make([]wltintegration.StoreCommercialAgreement, 0, len(agreements))
	for _, item := range agreements {
		if strings.TrimSpace(item.StoreID) == strings.TrimSpace(storeID) && strings.TrimSpace(item.PartnerActorID) == strings.TrimSpace(partnerActorID) {
			result = append(result, item)
		}
	}
	return result
}

func validStoreAgreementReason(value string) bool {
	value = strings.TrimSpace(value)
	runes := utf8.RuneCountInString(value)
	return runes >= 8 && runes <= 500
}

func validStoreAgreementMutationHeaders(idempotencyKey, correlationID string) bool {
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	return len(idempotencyKey) >= 8 && len(idempotencyKey) <= 128 && len(correlationID) >= 8 && len(correlationID) <= 128
}

func isSupportedStoreAgreementMode(mode string) bool {
	switch mode {
	case "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP":
		return true
	default:
		return false
	}
}
