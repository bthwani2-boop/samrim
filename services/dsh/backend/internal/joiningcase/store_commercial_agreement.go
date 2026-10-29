package joiningcase

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
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

type StoreCommercialAgreementAcceptanceInput struct {
	ExpectedAgreementVersion int
	Reason                   string
	IdempotencyKey           string
	CorrelationID            string
}

func storeAllowsCommercialAgreementProposal(publicationState string) bool {
	// "hidden" is the state the publication endpoint writes when a Store leaves the
	// storefront; "unpublished" is accepted for legacy rows.
	return publicationState == "hidden" || publicationState == "unpublished" || publicationState == "published"
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

func (s *Service) ReadStoreCommercialAgreementsForOperatorPartners(ctx context.Context, storeID, actingActorID string) ([]wltintegration.StoreCommercialAgreement, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	storeID = strings.TrimSpace(storeID)
	if storeID == "" || len(storeID) > 128 {
		return nil, ErrStoreAgreementInvalidInput
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return nil, err
	}
	return s.wlt.ReadStoreCommercialAgreements(ctx, store.ID)
}

// Operator Partners may propose, never accept on behalf of the Partner or
// approve on behalf of Finance. WLT owns every agreement transition.
func (s *Service) ProposeStoreCommercialAgreementForOperatorPartners(ctx context.Context, storeID, actingActorID string, input StoreCommercialAgreementProposalInput, idempotencyKey, correlationID string) (wltintegration.StoreCommercialAgreement, bool, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	storeID, actingActorID = strings.TrimSpace(storeID), strings.TrimSpace(actingActorID)
	if storeID == "" || len(storeID) > 128 || !validStoreAgreementMutationHeaders(idempotencyKey, correlationID) || !validStoreAgreementReason(input.Reason) || input.ExpectedCurrentVersion < 0 {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementInvalidInput
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	if store.PartnerActorID == "" || store.PartnerActorID == actingActorID || !storeAllowsCommercialAgreementProposal(store.PublicationState) {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementState
	}
	rates, err := normalizeStoreAgreementRates(store.FulfillmentModes, input.Rates)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementInvalidInput
	}
	agreement, replayed, err := s.wlt.ProposeStoreCommercialAgreement(ctx, wltintegration.ProposeStoreCommercialAgreementInput{
		StoreID: store.ID, PartnerActorID: store.PartnerActorID, Rates: rates,
		ExpectedCurrentVersion: input.ExpectedCurrentVersion, Reason: input.Reason,
	}, strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID), actingActorID)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	if agreement.StoreID != store.ID || agreement.PartnerActorID != store.PartnerActorID || agreement.ProposedByActorID != actingActorID || agreement.Status != "PROPOSED" {
		return wltintegration.StoreCommercialAgreement{}, false, errors.New("WLT agreement proposal readback does not match the authorized Partners operator")
	}
	return agreement, replayed, nil
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

func (s *Service) AcceptStoreCommercialAgreementForPartner(ctx context.Context, accessToken, storeID, agreementID string, input StoreCommercialAgreementAcceptanceInput) (wltintegration.StoreCommercialAgreement, bool, error) {
	partner, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return wltintegration.StoreCommercialAgreement{}, false, err
	}
	storeID, agreementID = strings.TrimSpace(storeID), strings.TrimSpace(agreementID)
	if storeID == "" || len(storeID) > 128 || agreementID == "" || input.ExpectedAgreementVersion < 1 || !validStoreAgreementMutationHeaders(input.IdempotencyKey, input.CorrelationID) || !validStoreAgreementReason(input.Reason) {
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
	agreement, replayed, err := s.wlt.AcceptStoreCommercialAgreement(ctx, selected.AgreementID, input.ExpectedAgreementVersion, input.Reason, strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID), partner.Subject)
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
	if actingActorID == selected.PartnerActorID {
		return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementForbidden
	}
	// Only the canonical initial Operator may approve a proposal they created.
	// This assertion comes from Identity on each request, never from UI input.
	input.RootOwnerSelfApproval = false
	if actingActorID == selected.ProposedByActorID {
		if err := s.identity.RequireOperatorProfileAdministrator(ctx, actingActorID); err != nil {
			return wltintegration.StoreCommercialAgreement{}, false, ErrStoreAgreementForbidden
		}
		input.RootOwnerSelfApproval = true
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

func normalizeStoreAgreementRates(storeModes []string, rates []wltintegration.StoreCommercialAgreementRate) ([]wltintegration.StoreCommercialAgreementRate, error) {
	modes, err := postgres.NormalizeStoreFulfillmentModes(storeModes)
	if err != nil || len(modes) == 0 || len(rates) != len(modes) {
		return nil, ErrStoreAgreementInvalidInput
	}
	byMode := make(map[string]wltintegration.StoreCommercialAgreementRate, len(rates))
	for _, rate := range rates {
		mode := strings.ToUpper(strings.TrimSpace(rate.FulfillmentMode))
		if !isSupportedStoreAgreementMode(mode) || rate.CommissionRateBps < 0 || rate.CommissionRateBps > 10000 || rate.DeliveryMarkupMinor < 0 || rate.DeliveryMarkupMinor > 10000 || rate.DeliveryFixedFeeMinor < 0 || rate.DeliveryFixedFeeMinor > 20000 || (mode != "PARTNER_CAPTAIN" && ((rate.DeliveryPricingMode != "" && strings.ToUpper(strings.TrimSpace(rate.DeliveryPricingMode)) != "DISTANCE") || rate.DeliveryFixedFeeMinor != 0)) || (mode == "PARTNER_CAPTAIN" && !validPartnerCaptainFeeMode(rate.DeliveryPricingMode, rate.DeliveryFixedFeeMinor)) || (rate.DeliveryMarkupMinor > 0 && (mode != "BTHWANI_CAPTAIN" || rate.CommissionRateBps != 0)) {
			return nil, ErrStoreAgreementInvalidInput
		}
		if _, exists := byMode[mode]; exists {
			return nil, ErrStoreAgreementInvalidInput
		}
		byMode[mode] = wltintegration.StoreCommercialAgreementRate{FulfillmentMode: mode, CommissionRateBps: rate.CommissionRateBps, DeliveryMarkupMinor: rate.DeliveryMarkupMinor, DeliveryPricingMode: normalizedPartnerCaptainPricingMode(rate.DeliveryPricingMode), DeliveryFixedFeeMinor: rate.DeliveryFixedFeeMinor}
	}
	result := make([]wltintegration.StoreCommercialAgreementRate, 0, len(modes))
	for _, mode := range modes {
		rate, exists := byMode[mode]
		if !exists {
			return nil, ErrStoreAgreementInvalidInput
		}
		result = append(result, rate)
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

func normalizedPartnerCaptainPricingMode(raw string) string {
	mode := strings.ToUpper(strings.TrimSpace(raw))
	if mode == "" {
		return "DISTANCE"
	}
	return mode
}

func validPartnerCaptainFeeMode(raw string, fixed int64) bool {
	if fixed < 0 || fixed > 20000 {
		return false
	}
	switch normalizedPartnerCaptainPricingMode(raw) {
	case "DISTANCE", "FREE":
		return fixed == 0
	case "FIXED":
		return fixed > 0
	default:
		return false
	}
}
