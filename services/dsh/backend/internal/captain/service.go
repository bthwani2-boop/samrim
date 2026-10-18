package captain

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	phoneformat "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/phone"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrInvalidInput                   = errors.New("captain input is invalid")
	ErrOperatorNotActive              = errors.New("operator is not active")
	ErrCaptainSessionForbidden        = errors.New("an active app-captain session is required")
	ErrPartnerSessionForbidden        = errors.New("an active app-partner session is required")
	ErrManagedRoleClosed              = errors.New("managed role mutation is outside the DSH-owned domain boundary")
	ErrManagedRoleNotEligible         = errors.New("managed role is not currently eligible in its owning domain")
	ErrManagedRoleVersionConflict     = errors.New("managed role version is stale")
	ErrCaptainIdentityUnavailable     = errors.New("captain identity was not provisioned")
	ErrPaymentUnavailable             = errors.New("payment collection is unavailable")
	ErrCaptainWalletInsufficientFunds = errors.New("captain wallet cannot cover COD exposure")
	ErrCollectionAmountMismatch       = errors.New("collected amount does not match the order amount")
)

type Service struct {
	identity  *identityintegration.Client
	db        *sql.DB
	payment   *wlt.Client
	proofKeys *postgres.DeliveryProofKeyring
}

func New(identity *identityintegration.Client, db *sql.DB, payment *wlt.Client, proofKeys *postgres.DeliveryProofKeyring) (*Service, error) {
	if identity == nil || db == nil || payment == nil || proofKeys == nil {
		return nil, errors.New("captain configuration is invalid")
	}
	return &Service{identity: identity, db: db, payment: payment, proofKeys: proofKeys}, nil
}

func (s *Service) Admit(ctx context.Context, fullNameAr, phone, walletProviderKey, idempotencyKey, actingActorID, correlationID string) (postgres.CaptainAdmission, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	phone = phoneformat.NormalizeYemenE164(phone)
	walletProviderKey, providerKeyValid := postgres.NormalizeWalletProviderKey(walletProviderKey)
	if len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || !phoneformat.IsE164(phone) || !providerKeyValid || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	activeProvider, providerErr := postgres.IsActiveWalletProvider(ctx, s.db, walletProviderKey)
	if providerErr != nil {
		return postgres.CaptainAdmission{}, false, providerErr
	}
	if !activeProvider {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	hash := postgres.HashCaptainAdmissionRequest(fullNameAr, phone, walletProviderKey)
	admission, replayed, err := postgres.CreateCaptainAdmissionCandidate(ctx, s.db, fullNameAr, phone, walletProviderKey, strings.TrimSpace(idempotencyKey), hash, strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	return admission, replayed, nil
}

func (s *Service) Approve(ctx context.Context, admissionID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.CaptainAdmission, bool, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if expectedVersion < 1 {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	return postgres.ApproveCaptainAdmission(ctx, s.db, admissionID, expectedVersion, idempotencyKey, postgres.HashCaptainAdmissionApprovalRequest(admissionID, expectedVersion), actingActorID, correlationID)
}

func (s *Service) Provision(ctx context.Context, admissionID, idempotencyKey, actingActorID, correlationID string) (postgres.CaptainAdmission, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainAdmission{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, err
	}
	admission, err := postgres.ReadCaptainAdmission(ctx, s.db, admissionID)
	if err != nil {
		return postgres.CaptainAdmission{}, err
	}
	if admission.State == "eligible" {
		return admission, nil
	}
	if admission.State != "pending_identity" || admission.PhoneE164 == "" {
		return postgres.CaptainAdmission{}, postgres.ErrCaptainAdmissionNotEligible
	}
	role, err := s.identity.ProvisionCaptainWithContext(ctx, identityintegration.ActorInput{PhoneE164: admission.PhoneE164}, correlationID, actingActorID)
	if err != nil {
		return postgres.CaptainAdmission{}, err
	}
	if role.Role != "captain" || strings.TrimSpace(role.ActorID) == "" {
		return postgres.CaptainAdmission{}, ErrCaptainIdentityUnavailable
	}
	if !role.Enabled || !role.SecurityEnabled {
		return postgres.CaptainAdmission{}, ErrManagedRoleNotEligible
	}
	return postgres.BindCaptainAdmission(ctx, s.db, admission.ID, role.ActorID, idempotencyKey, postgres.HashCaptainAdmissionTransition("bind", admissionID), actingActorID, correlationID)
}

func (s *Service) ReadForOperator(ctx context.Context, admissionID, actingActorID string) (postgres.CaptainAdmission, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, err
	}
	return postgres.ReadCaptainAdmission(ctx, s.db, admissionID)
}

func (s *Service) ListAdmissionsForOperator(ctx context.Context, query, state, sort string, limit int, cursor, actingActorID string) (postgres.CaptainAdmissionPage, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmissionPage{}, err
	}
	return postgres.ListCaptainAdmissions(ctx, s.db, query, state, sort, limit, cursor)
}

func (s *Service) UpdateAdmissionProfile(ctx context.Context, admissionID, fullNameAr string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.CaptainAdmission, bool, error) {
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	return postgres.UpdateCaptainAdmissionProfile(ctx, s.db, admissionID, fullNameAr, expectedVersion, idempotencyKey, postgres.HashCaptainAdmissionProfileRequest(admissionID, fullNameAr, expectedVersion), actingActorID, correlationID)
}

func (s *Service) ReviewAdmissionProfile(ctx context.Context, admissionID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.CaptainAdmission, bool, error) {
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	return postgres.ReviewCaptainAdmissionProfile(ctx, s.db, admissionID, expectedVersion, idempotencyKey, postgres.HashCaptainAdmissionProfileReviewRequest(admissionID, expectedVersion), actingActorID, correlationID)
}

func (s *Service) ReadForOperatorByActor(ctx context.Context, actorID, actingActorID string) (postgres.CaptainAdmission, error) {
	if strings.TrimSpace(actorID) == "" {
		return postgres.CaptainAdmission{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAdmission{}, err
	}
	return postgres.ReadCaptainAdmissionForActor(ctx, s.db, actorID)
}

func (s *Service) ReadForCaptain(ctx context.Context, accessToken string) (postgres.CaptainAdmission, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAdmission{}, err
	}
	admission, err := postgres.ReadCaptainAdmissionForActor(ctx, s.db, identity.Subject)
	if err != nil {
		return postgres.CaptainAdmission{}, err
	}
	role, err := s.identity.ReadActorRole(ctx, identity.Subject, "captain")
	if err != nil {
		return postgres.CaptainAdmission{}, err
	}
	if role.Role != "captain" {
		return postgres.CaptainAdmission{}, ErrCaptainIdentityUnavailable
	}
	admission.PhoneE164 = role.PhoneE164
	return admission, nil
}

// authorizePartnerStoreFulfillment admits the Store owner or a delegate holding an
// active Store-scoped `fulfillment` grant to Store-captain fulfillment operations.
func (s *Service) authorizePartnerStoreFulfillment(ctx context.Context, storeID, actorID string) error {
	if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, s.db, strings.TrimSpace(storeID), strings.TrimSpace(actorID), "fulfillment"); err != nil {
		if errors.Is(err, postgres.ErrStoreAccessForbidden) || errors.Is(err, postgres.ErrStoreNotFound) {
			return ErrPartnerSessionForbidden
		}
		return err
	}
	return nil
}

func (s *Service) ReadForPartner(ctx context.Context, accessToken, storeID, orderID string) (postgres.CaptainAssignment, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, err
	}
	if err := s.authorizePartnerStoreFulfillment(ctx, storeID, identity.Subject); err != nil {
		return postgres.CaptainAssignment{}, err
	}
	assignment, err := postgres.ReadCaptainAssignmentForOrder(ctx, s.db, strings.TrimSpace(orderID))
	if err != nil {
		return postgres.CaptainAssignment{}, err
	}
	if assignment.Handoff.StoreID != strings.TrimSpace(storeID) {
		return postgres.CaptainAssignment{}, ErrPartnerSessionForbidden
	}
	return assignment, nil
}

func (s *Service) SetAvailability(ctx context.Context, accessToken string, available bool, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAdmission, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	return postgres.SetCaptainAvailability(ctx, s.db, identity.Subject, available, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainAvailabilityRequest(identity.Subject, available, expectedVersion), identity.Subject, strings.TrimSpace(correlationID), "")
}

func (s *Service) SetAvailabilityForOperator(ctx context.Context, actorID, operatorActorID string, available bool, expectedVersion int, idempotencyKey, correlationID, reason string) (postgres.CaptainAdmission, bool, error) {
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	reason = strings.TrimSpace(reason)
	if actorID == "" || expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, operatorActorID) || len([]rune(reason)) < 5 || len([]rune(reason)) > 500 {
		return postgres.CaptainAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, operatorActorID); err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	role, err := s.identity.ReadActorRole(ctx, actorID, "captain")
	if err != nil {
		return postgres.CaptainAdmission{}, false, err
	}
	if role.Role != "captain" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil {
		return postgres.CaptainAdmission{}, false, ErrManagedRoleNotEligible
	}
	requestHash := postgres.HashCaptainOperatorAvailabilityRequest(actorID, available, expectedVersion, reason)
	return postgres.SetCaptainAvailability(ctx, s.db, actorID, available, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, operatorActorID, strings.TrimSpace(correlationID), reason)
}

func (s *Service) ListOffers(ctx context.Context, accessToken string, limit int) ([]postgres.CaptainOffer, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidInput
	}
	return postgres.ListCaptainOffers(ctx, s.db, identity.Subject, limit)
}

func (s *Service) RespondToOffer(ctx context.Context, accessToken, offerID, decision string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainOfferResult, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainOfferResult{}, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainOfferResult{}, ErrInvalidInput
	}
	offerID = strings.TrimSpace(offerID)
	decision = strings.ToLower(strings.TrimSpace(decision))
	requestHash := postgres.HashCaptainOfferResponse(offerID, decision, expectedVersion)
	if decision != "accept" {
		return postgres.RespondToCaptainOffer(ctx, s.db, offerID, identity.Subject, decision, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
	}
	offer, err := postgres.ReadCaptainOffer(ctx, s.db, offerID)
	if err != nil {
		return postgres.CaptainOfferResult{}, err
	}
	reserveEligible, err := captainOfferAcceptancePreflight(offer, identity.Subject, expectedVersion, time.Now().UTC())
	if err != nil {
		return postgres.CaptainOfferResult{}, err
	}
	if !reserveEligible {
		return postgres.RespondToCaptainOffer(ctx, s.db, offerID, identity.Subject, decision, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
	}
	order, err := postgres.ReadOrder(ctx, s.db, offer.OrderID)
	if err != nil {
		return postgres.CaptainOfferResult{}, err
	}
	if order.FulfillmentMode == "BTHWANI_CAPTAIN" {
		if err := s.requireCaptainMinimumBalance(ctx, identity.Subject); err != nil {
			return postgres.CaptainOfferResult{}, err
		}
	}
	reserved := false
	if order.FulfillmentMode == "BTHWANI_CAPTAIN" && order.PaymentCashAmountMinor > 0 && order.PaymentIntentID != nil && strings.TrimSpace(*order.PaymentIntentID) != "" {
		_, _, reserveErr := s.payment.ReserveCaptainCOD(ctx, order.ID, *order.PaymentIntentID, identity.Subject, wlt.DerivedIdempotencyKey("captain-cod-reserve", offer.ID), correlationID)
		if reserveErr != nil {
			return postgres.CaptainOfferResult{}, classifyCaptainCODReserveError(reserveErr)
		}
		reserved = true
	}
	result, respondErr := postgres.RespondToCaptainOffer(ctx, s.db, offerID, identity.Subject, decision, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
	if respondErr == nil || !reserved {
		return result, respondErr
	}
	currentOffer, readErr := postgres.ReadCaptainOffer(ctx, s.db, offerID)
	if readErr == nil && currentOffer.State != "accepted" {
		_, _, releaseErr := s.payment.ReleaseCaptainCOD(ctx, order.ID, *order.PaymentIntentID, identity.Subject, wlt.DerivedIdempotencyKey("captain-cod-release", offer.ID), correlationID)
		if releaseErr != nil {
			return postgres.CaptainOfferResult{}, fmt.Errorf("%w: offer failed and COD reservation could not be released: %v", ErrPaymentUnavailable, releaseErr)
		}
	}
	return result, respondErr
}

// A competing captain already holding the only active COD reservation is a
// normal parallel-dispatch race; only transport/unknown failures are outages.
func classifyCaptainCODReserveError(err error) error {
	var financial *wlt.Error
	if errors.As(err, &financial) && financial.Status == 409 {
		switch financial.Code {
		case "STATE_CONFLICT":
			return postgres.ErrCaptainAssignmentConflict
		case "INSUFFICIENT_FUNDS":
			return ErrCaptainWalletInsufficientFunds
		case "COD_EXPOSURE_UNAVAILABLE":
			return postgres.ErrPaymentStateConflict
		}
	}
	return fmt.Errorf("%w: captain COD authorization unavailable: %v", ErrPaymentUnavailable, err)
}

// A Captain must own a current, actionable offer before any external COD reserve.
// Terminal/expired offers continue through the canonical replay/expiry path.
func captainOfferAcceptancePreflight(offer postgres.CaptainOffer, captainActorID string, expectedVersion int, now time.Time) (bool, error) {
	if offer.CaptainActorID != captainActorID {
		return false, postgres.ErrCaptainOfferForbidden
	}
	if offer.State != "offered" || !now.Before(offer.ExpiresAt) {
		return false, nil
	}
	if offer.Version != expectedVersion {
		return false, postgres.ErrCaptainVersionConflict
	}
	return true, nil
}

func (s *Service) ListAssignments(ctx context.Context, accessToken string, limit int) ([]postgres.CaptainAssignment, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidInput
	}
	return postgres.ListCaptainAssignments(ctx, s.db, identity.Subject, limit)
}

func (s *Service) ReadCashLiability(ctx context.Context, accessToken string) (wlt.CashLiabilityResponse, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return wlt.CashLiabilityResponse{}, err
	}
	return s.payment.ListCashLiability(ctx, identity.Subject)
}

func (s *Service) RemitCash(ctx context.Context, accessToken, paymentIntentID string, amountMinor int64, remittanceReference string, expectedPaymentVersion int, idempotencyKey, correlationID string) (wlt.CashRemittance, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return wlt.CashRemittance{}, false, err
	}
	if expectedPaymentVersion < 1 || amountMinor <= 0 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return wlt.CashRemittance{}, false, ErrInvalidInput
	}
	return s.payment.RemitCash(ctx, paymentIntentID, identity.Subject, amountMinor, remittanceReference, expectedPaymentVersion, idempotencyKey, correlationID)
}

func (s *Service) ReadDeliveryTask(ctx context.Context, accessToken, assignmentID string) (postgres.CaptainDeliveryTask, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainDeliveryTask{}, err
	}
	if strings.TrimSpace(assignmentID) == "" {
		return postgres.CaptainDeliveryTask{}, ErrInvalidInput
	}
	task, err := postgres.ReadCaptainDeliveryTask(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject)
	if err != nil {
		return postgres.CaptainDeliveryTask{}, err
	}
	if task.FulfillmentMode == postgres.FulfillmentModeBthwaniCaptain && task.PaymentIntentID != "" {
		payment, paymentErr := s.payment.Read(ctx, task.PaymentIntentID)
		if paymentErr == nil && payment.ID == task.PaymentIntentID && payment.CustomerPaymentAllocation != nil && payment.CustomerPaymentAllocation.OrderID == task.OrderReference && payment.CustomerPaymentAllocation.Currency == task.Currency && payment.CustomerPaymentAllocation.FulfillmentMode == task.FulfillmentMode {
			fee := payment.CustomerPaymentAllocation.DeliveryFeeMinor
			task.DeliveryFeeMinor = &fee
		}
	}
	return task, nil
}

// UpdatePresence only accepts authenticated captains and only persists their latest position.
func (s *Service) UpdatePresence(ctx context.Context, accessToken string, latitude, longitude float64) (time.Time, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return time.Time{}, err
	}
	return postgres.UpdateCaptainPresence(ctx, s.db, identity.Subject, latitude, longitude)
}

// Opportunity zones are derived from Store-origin orders, not Captain GPS.
func (s *Service) OpportunitiesForOperator(ctx context.Context, actorID string) (postgres.CaptainOpportunityHeatmap, error) {
	if err := s.requireOperator(ctx, actorID); err != nil {
		return postgres.CaptainOpportunityHeatmap{}, err
	}
	return postgres.ReadCaptainOpportunityHeatmap(ctx, s.db)
}

func (s *Service) OpportunitiesForCaptain(ctx context.Context, accessToken string) (postgres.CaptainOpportunityHeatmap, error) {
	if _, err := s.requireCaptain(ctx, accessToken); err != nil {
		return postgres.CaptainOpportunityHeatmap{}, err
	}
	return postgres.ReadCaptainOpportunityHeatmap(ctx, s.db)
}

func (s *Service) Pickup(ctx context.Context, accessToken, assignmentID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	return postgres.CompleteCaptainPickup(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainPickupRequest(assignmentID, expectedVersion), strings.TrimSpace(correlationID))
}

func (s *Service) Complete(ctx context.Context, accessToken, assignmentID, result string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) || collectedAmountMinor < 0 {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	submittedResult := strings.TrimSpace(result)
	result = strings.ToLower(submittedResult)
	deliveryProofCode = strings.TrimSpace(deliveryProofCode)
	if result != "delivered" && result != "delivery_failed" {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	if result == "delivery_failed" && collectedAmountMinor != 0 {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	assignment, replayed, err := postgres.CompleteCaptainAssignment(ctx, s.db, strings.TrimSpace(assignmentID), identity.Subject, submittedResult, collectedAmountMinor, deliveryProofCode, expectedVersion, strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID), s.proofKeys)
	if errors.Is(err, postgres.ErrCaptainCollectedAmountMismatch) {
		return postgres.CaptainAssignment{}, false, ErrCollectionAmountMismatch
	}
	return assignment, replayed, err
}

func (s *Service) Recover(ctx context.Context, assignmentID, actingActorID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	assignmentID = strings.TrimSpace(assignmentID)
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, actingActorID) || assignmentID == "" {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	return postgres.RecoverCaptainAssignment(ctx, s.db, assignmentID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainRecoveryRequest(assignmentID, expectedVersion), actingActorID, strings.TrimSpace(correlationID))
}

// ReconcileAutomaticDispatch runs only inside the DSH worker; it is not an
// externally callable role bypass. Each insert is guarded by the canonical
// order lock, duplicate-offer constraints, and the WLT wallet preflight.
func (s *Service) ReconcileAutomaticDispatch(ctx context.Context, afterID string) (string, error) {
	if err := postgres.CanonicalizeCaptainOffers(ctx, s.db, ""); err != nil {
		return afterID, err
	}
	const pageSize = 25
	orderIDs, err := postgres.ListReadyCaptainDispatchOrders(ctx, s.db, pageSize, afterID)
	if err != nil {
		return afterID, err
	}
	var firstErr error
	for _, orderID := range orderIDs {
		if err := ctx.Err(); err != nil {
			return afterID, err
		}
		approved, err := s.dispatchCandidates(ctx, orderID)
		if errors.Is(err, postgres.ErrCaptainNoAvailable) {
			continue
		}
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("dispatch order %s: %w", orderID, err)
			}
			continue
		}
		key := fmt.Sprintf("auto-dispatch:%s:%d", orderID, time.Now().UTC().UnixNano())
		_, _, err = postgres.CreateCaptainDispatchOffer(ctx, s.db, orderID, key, postgres.HashCaptainDispatchRequest(orderID), "system-captain-dispatch", key, approved...)
		if errors.Is(err, postgres.ErrCaptainDispatchConflict) || errors.Is(err, postgres.ErrCaptainNoAvailable) {
			continue
		}
		if err != nil && firstErr == nil {
			firstErr = fmt.Errorf("dispatch order %s: %w", orderID, err)
		}
	}
	if len(orderIDs) < pageSize {
		return "", firstErr
	}
	return orderIDs[len(orderIDs)-1], firstErr
}

// dispatchCandidates checks fresh nearby presence and the canonical WLT wallet
// before any offer is issued. WLT reserves the actual COD exposure on acceptance.
func (s *Service) dispatchCandidates(ctx context.Context, orderID string) ([]string, error) {
	candidates, cashMinor, err := postgres.ListNearbyCaptainCandidates(ctx, s.db, orderID, "")
	if err != nil {
		return nil, err
	}
	minimum, err := s.captainMinimumBalance(ctx)
	if err != nil {
		return nil, err
	}
	return selectFundedNearbyCaptains(ctx, candidates, cashMinor, minimum, s.payment.ReadCaptainWalletState)
}

func (s *Service) Dispatch(ctx context.Context, orderID, actingActorID, idempotencyKey, correlationID string) (postgres.CaptainOffer, bool, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainOffer{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	approved, err := s.dispatchCandidates(ctx, strings.TrimSpace(orderID))
	if errors.Is(err, postgres.ErrCaptainNoAvailable) {
		// The database verifies idempotent replay before trying new candidates.
		// An empty non-nil approved list denies a fresh offer while preserving
		// the existing operation when its captain is already reserved.
		approved = []string{}
	} else if err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	return postgres.CreateCaptainDispatchOffer(ctx, s.db, strings.TrimSpace(orderID), strings.TrimSpace(idempotencyKey), postgres.HashCaptainDispatchRequest(orderID), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID), approved...)
}

func (s *Service) DispatchForPartner(ctx context.Context, accessToken, storeID, orderID, captainActorID string, expectedOrderVersion int, idempotencyKey, correlationID string) (postgres.CaptainOffer, bool, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	if expectedOrderVersion < 1 || strings.TrimSpace(storeID) == "" || strings.TrimSpace(orderID) == "" || strings.TrimSpace(captainActorID) == "" || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainOffer{}, false, ErrInvalidInput
	}
	if err := s.authorizePartnerStoreFulfillment(ctx, storeID, identity.Subject); err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	// Store-managed captains use PARTNER_CAPTAIN fulfillment; this platform
	// wallet minimum applies only to BTHWANI_CAPTAIN orders.
	requestHash := postgres.HashStoreCaptainDispatchRequest(storeID, orderID, captainActorID, expectedOrderVersion)
	return postgres.CreateStoreCaptainDispatchOffer(ctx, s.db, strings.TrimSpace(storeID), strings.TrimSpace(orderID), strings.TrimSpace(captainActorID), identity.Subject, expectedOrderVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
}

func (s *Service) ReadStoreDispatchForPartner(ctx context.Context, accessToken, storeID, orderID string) (postgres.CaptainOffer, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.CaptainOffer{}, err
	}
	if err := s.authorizePartnerStoreFulfillment(ctx, storeID, identity.Subject); err != nil {
		return postgres.CaptainOffer{}, err
	}
	return postgres.ReadStoreCaptainDispatchOffer(ctx, s.db, strings.TrimSpace(storeID), strings.TrimSpace(orderID), identity.Subject)
}

func (s *Service) Reassign(ctx context.Context, orderID, actingActorID, idempotencyKey, correlationID string) (postgres.CaptainOffer, bool, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.CaptainOffer{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	approved, err := s.dispatchCandidates(ctx, strings.TrimSpace(orderID))
	if errors.Is(err, postgres.ErrCaptainNoAvailable) {
		// The database verifies idempotent replay before trying new candidates.
		// An empty non-nil approved list denies a fresh offer while preserving
		// the existing operation when its captain is already reserved.
		approved = []string{}
	} else if err != nil {
		return postgres.CaptainOffer{}, false, err
	}
	return postgres.ReassignCaptain(ctx, s.db, strings.TrimSpace(orderID), strings.TrimSpace(idempotencyKey), postgres.HashCaptainReassignmentRequest(orderID), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID), approved...)
}

func (s *Service) ConfirmStoreHandoff(ctx context.Context, accessToken, orderID, storeID, assignmentID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CaptainAssignment, bool, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.CaptainAssignment{}, false, ErrInvalidInput
	}
	if err := s.authorizePartnerStoreFulfillment(ctx, storeID, identity.Subject); err != nil {
		return postgres.CaptainAssignment{}, false, err
	}
	return postgres.ConfirmStoreHandoff(ctx, s.db, strings.TrimSpace(orderID), strings.TrimSpace(storeID), strings.TrimSpace(assignmentID), expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCaptainHandoffRequest(assignmentID, storeID, expectedVersion), identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) SetManagedRoleEnabled(ctx context.Context, role, actorID, operatorActorID, correlationID, idempotencyKey, reason string, expectedVersion int, enabled bool) error {
	role = strings.TrimSpace(role)
	actorID = strings.TrimSpace(actorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if (role != "partner" && role != "captain") || actorID == "" || strings.TrimSpace(correlationID) == "" || idempotencyKey == "" || expectedVersion < 1 {
		return ErrInvalidInput
	}
	permission := "operations"
	if role == "partner" {
		permission = "partners"
	}
	if err := s.requireOperatorPermission(ctx, operatorActorID, permission); err != nil {
		return err
	}
	identityRole, err := s.identity.ReadActorRole(ctx, actorID, role)
	if err != nil {
		return err
	}
	if identityRole.Role != role {
		return ErrManagedRoleNotEligible
	}
	if identityRole.Enabled != enabled && identityRole.RoleVersion != expectedVersion {
		return ErrManagedRoleVersionConflict
	}

	if role == "partner" {
		if enabled {
			joining, err := postgres.ReadJoiningCaseForPartner(ctx, s.db, actorID)
			if err != nil {
				return err
			}
			switch joining.Case.State {
			case "submitted", "needs_correction", "approved":
			default:
				return ErrManagedRoleNotEligible
			}
		}
		if identityRole.Enabled == enabled {
			return nil
		}
		return s.identity.SetRoleEnabledWithContext(ctx, actorID, role, enabled, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion)
	}

	accessHash := postgres.HashCaptainAccessRequest(actorID, role, enabled, expectedVersion)
	if enabled {
		if _, err := postgres.RestoreCaptainAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, strings.TrimSpace(operatorActorID), strings.TrimSpace(correlationID)); err != nil {
			return err
		}
		if identityRole.Enabled != enabled {
			return s.identity.SetRoleEnabledWithContext(ctx, actorID, role, true, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion)
		}
		return nil
	}

	if _, err := postgres.SuspendCaptainAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, strings.TrimSpace(operatorActorID), strings.TrimSpace(correlationID)); err != nil {
		return err
	}
	if identityRole.Enabled == enabled {
		return nil
	}
	return s.identity.SetRoleEnabledWithContext(ctx, actorID, role, false, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion)
}

func (s *Service) AuthorizeManagedRoleReenrollment(ctx context.Context, role, actorID, operatorActorID, correlationID, reason string, expectedDomainVersion, expectedActorVersion, expectedRoleVersion int) error {
	role = strings.ToLower(strings.TrimSpace(role))
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	correlationID = strings.TrimSpace(correlationID)
	reason = strings.TrimSpace(reason)
	if (role != "partner" && role != "captain") || actorID == "" || expectedDomainVersion < 1 || expectedActorVersion < 1 || expectedRoleVersion < 1 || len([]rune(reason)) < 5 || len([]rune(reason)) > 500 || !validMutation("managed-role-reenrollment", correlationID, operatorActorID) {
		return ErrInvalidInput
	}
	permission := "operations"
	if role == "partner" {
		permission = "partners"
	}
	if err := s.requireOperatorPermission(ctx, operatorActorID, permission); err != nil {
		return err
	}

	if role == "partner" {
		tx, state, version, err := postgres.LockPartnerJoiningCase(ctx, s.db, actorID)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback() }()
		if version != expectedDomainVersion {
			return ErrManagedRoleVersionConflict
		}
		if !partnerJoiningStateAllowsReenrollment(state) {
			return ErrManagedRoleNotEligible
		}
		return s.identity.AuthorizeReenrollmentWithContext(ctx, actorID, role, correlationID, reason, operatorActorID, expectedActorVersion, expectedRoleVersion)
	}

	tx, admission, err := postgres.LockCaptainReenrollmentAdmission(ctx, s.db, actorID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if admission.Version != expectedDomainVersion {
		return ErrManagedRoleVersionConflict
	}
	if !captainAdmissionAllowsReenrollment(admission) {
		return ErrManagedRoleNotEligible
	}
	return s.identity.AuthorizeReenrollmentWithContext(ctx, actorID, role, correlationID, reason, operatorActorID, expectedActorVersion, expectedRoleVersion)
}

func partnerJoiningStateAllowsReenrollment(state string) bool {
	switch state {
	case "submitted", "needs_correction", "approved":
		return true
	default:
		return false
	}
}

func captainAdmissionAllowsReenrollment(admission postgres.CaptainAdmission) bool {
	return admission.State == "eligible" && !admission.RequiresProfileReview
}

func (s *Service) requireCaptain(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "captain" || identity.Surface != "app-captain" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrCaptainSessionForbidden
	}
	return identity, nil
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
	return s.requireOperatorPermission(ctx, actorID, "operations")
}

func (s *Service) requireOperatorPermission(ctx context.Context, actorID, permission string) error {
	actorID = strings.TrimSpace(actorID)
	operator, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return s.identity.RequireOperatorPermission(ctx, actorID, permission)
}

func validMutation(idempotencyKey, correlationID, actingActorID string) bool {
	return len(strings.TrimSpace(idempotencyKey)) >= 8 && len(strings.TrimSpace(idempotencyKey)) <= 128 && len(strings.TrimSpace(correlationID)) >= 8 && len(strings.TrimSpace(correlationID)) <= 128 && strings.TrimSpace(actingActorID) != ""
}
