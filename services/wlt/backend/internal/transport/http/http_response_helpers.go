package http

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	"github.com/lib/pq"
)

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	provided := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(r.Header.Get("Authorization")), "Bearer "))
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.serviceToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "WLT service authorization is required")
		return false
	}
	return true
}

func mutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlation, idempotency, true
}

func versionedMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return "", "", 0, false
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeJSONWithLimit(w, r, target, 32*1024)
}

func decodeJSONWithLimit(w http.ResponseWriter, r *http.Request, target any, limit int64) bool {
	return decodeJSONWithOptionalEmpty(w, r, target, limit, false)
}

func decodeOptionalJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeJSONWithOptionalEmpty(w, r, target, 32*1024, true)
}

func decodeJSONWithOptionalEmpty(w http.ResponseWriter, r *http.Request, target any, limit int64, allowEmpty bool) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	body, err := io.ReadAll(r.Body)
	if err != nil || !utf8.Valid(body) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return false
	}
	if allowEmpty && len(bytes.TrimSpace(body)) == 0 {
		return true
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body must contain exactly one JSON value")
		return false
	}
	return true
}

func toPaymentIntent(item postgres.PaymentIntentRecord) paymentIntentJSON {
	result := paymentIntentJSON{ID: item.ID, ExternalReference: item.ExternalReference, PayerActorID: item.PayerActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, Method: item.Method, State: item.State, Version: item.Version, CollectedAmountMinor: item.CollectedAmountMinor, CollectedByActorID: item.CollectedByActorID, CollectionReference: item.CollectionReference, CancellationReason: item.CancellationReason, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"), UpdatedAt: item.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	if item.CollectedAt != nil {
		value := item.CollectedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.CollectedAt = &value
	}
	if item.CustomerPaymentAllocation != nil {
		allocation := item.CustomerPaymentAllocation
		jsonAllocation := &customerPaymentAllocationJSON{ID: allocation.ID, OrderID: allocation.OrderID, PaymentIntentID: allocation.PaymentIntentID, StoreID: allocation.StoreID, PartnerActorID: allocation.PartnerActorID, CommercialStoreTypeID: allocation.CommercialStoreTypeID, FulfillmentMode: allocation.FulfillmentMode, Currency: allocation.Currency, SubtotalMinor: allocation.SubtotalMinor, DeliveryFeeMinor: allocation.DeliveryFeeMinor, DeliveryMarginMinor: allocation.DeliveryMarginMinor, DiscountMinor: allocation.DiscountMinor, InternalBalanceAmountMinor: allocation.InternalBalanceAmountMinor, CashAmountMinor: allocation.CashAmountMinor, CustomerPayableMinor: allocation.CustomerPayableMinor, PolicyVersion: allocation.PolicyVersion, CreatedAt: allocation.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
		if allocation.CommissionSnapshot != nil {
			snapshot := allocation.CommissionSnapshot
			jsonAllocation.CommissionSnapshot = &partnerStoreCommissionSnapshotJSON{CommercialStoreTypeID: snapshot.CommercialStoreTypeID, RateBps: snapshot.RateBps, PolicyVersion: snapshot.PolicyVersion, ProfileID: snapshot.ProfileID, ProfileVersion: snapshot.ProfileVersion, RoundingUnitMinor: snapshot.RoundingUnitMinor, SettlementPeriod: snapshot.SettlementPeriod}
		}
		result.CustomerPaymentAllocation = jsonAllocation
	}
	return result
}

func toCashRemittance(item postgres.CashRemittanceRecord) cashRemittanceJSON {
	result := cashRemittanceJSON{ID: item.ID, PaymentIntentID: item.PaymentIntentID, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, RemittanceReference: item.RemittanceReference, State: item.State, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"), ReconciledBy: item.ReconciledBy, ReceiptDocumentID: item.ReceiptDocumentID}
	if item.ReconciledAt != nil {
		value := item.ReconciledAt.UTC().Format(time.RFC3339Nano)
		result.ReconciledAt = &value
	}
	return result
}

func toDeliveryFeePolicy(item postgres.DeliveryFeePolicyRecord) deliveryFeePolicyJSON {
	result := deliveryFeePolicyJSON{DistanceBands: item.DistanceBands, ID: item.ID, ServiceCityID: item.ServiceCityID, PolicyVersion: item.PolicyVersion, State: item.State, BaseFeeMinor: item.BaseFeeMinor, DistanceUnitMeters: item.DistanceUnitMeters, DistanceRateMinor: item.DistanceRateMinor, OrderSizeUnitBaseUnits: item.OrderSizeUnitBaseUnits, OrderSizeRateMinor: item.OrderSizeRateMinor, ZoneSurchargeMinor: item.ZoneSurchargeMinor, RoundingUnitMinor: item.RoundingUnitMinor, Version: item.Version, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	if item.RetiredAt != nil {
		value := item.RetiredAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.RetiredAt = &value
	}
	return result
}

func toDeliveryFeeQuote(item postgres.DeliveryFeeQuoteRecord) deliveryFeeQuoteJSON {
	return deliveryFeeQuoteJSON{CaptainEarningMinor: item.CaptainEarningMinor, PlatformMarginMinor: item.PlatformMarginMinor, FeeMinor: item.FeeMinor, PolicyVersion: item.PolicyVersion, ServiceCityID: item.ServiceCityID, DistanceMeters: item.DistanceMeters, DistanceUnits: item.DistanceUnits, OrderSizeBaseUnits: item.OrderSizeBaseUnits, OrderSizeUnits: item.OrderSizeUnits, RoundingUnitMinor: item.RoundingUnitMinor}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func toOfficialWalletDestination(item postgres.OfficialWalletDestinationRecord) officialWalletDestinationJSON {
	return officialWalletDestinationJSON{ID: item.ID, ActorType: item.ActorType, ActorID: item.ActorID, ProviderKey: item.ProviderKey, WalletIdentifierMasked: item.WalletIdentifierMasked, BeneficiaryName: item.BeneficiaryName, BeneficiaryIdentityVersion: item.BeneficiaryIdentityVersion, VerificationStatus: item.VerificationStatus, Status: item.Status, Version: item.Version, ChangeReason: item.ChangeReason, SubmittedBy: item.SubmittedBy, SubmittedAt: item.SubmittedAt.UTC().Format(time.RFC3339Nano), VerifiedBy: item.VerifiedBy, VerifiedAt: formatNullableTime(item.VerifiedAt), ApprovedBy: item.ApprovedBy, ApprovedAt: formatNullableTime(item.ApprovedAt), VerificationEvidenceReference: item.VerificationEvidenceReference, ChangeEvidenceReference: item.ChangeEvidenceReference, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano), UpdatedAt: item.UpdatedAt.UTC().Format(time.RFC3339Nano)}
}

func toPayoutRequest(item postgres.PayoutRequestRecord) payoutRequestJSON {
	return payoutRequestJSON{BeneficiaryActorID: item.BeneficiaryActorID, ID: item.ID, ActorType: item.ActorType, ActorID: item.ActorID, AmountMode: item.AmountMode, RequestedAmountMinor: item.RequestedAmountMinor, ResolvedAmountMinor: item.ResolvedAmountMinor, Currency: item.Currency, DestinationID: item.DestinationID, DestinationVersion: item.DestinationVersion, Status: item.Status, PolicyVersion: item.PolicyVersion, LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano)}
}

func toPayoutState(item postgres.PayoutStateRecord) payoutStateJSON {
	result := payoutStateJSON{ActorType: item.ActorType, ActorID: item.ActorID, Currency: item.Currency, EligibleAvailableMinor: item.EligibleAvailableMinor, HeldMinor: item.HeldMinor, AcquiredStoreCount: item.AcquiredStoreCount, EarnedMinor: item.EarnedMinor}
	if item.Destination != nil {
		destination := toOfficialWalletDestination(*item.Destination)
		result.Destination = &destination
	}
	if item.LatestPayout != nil {
		payout := toPayoutRequest(*item.LatestPayout)
		result.LatestPayout = &payout
	}
	return result
}

func formatNullableTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339Nano)
	return &formatted
}

func writeDestinationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrReverificationRequired):
		writeError(w, http.StatusConflict, "REVERIFICATION_REQUIRED", "current verified Identity facts do not match the wallet destination")
	case errors.Is(err, postgres.ErrDestinationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "official wallet destination was not found")
	case errors.Is(err, postgres.ErrDestinationState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "official wallet destination state does not allow this operation")
	case errors.Is(err, postgres.ErrDestinationSeparation):
		writeError(w, http.StatusConflict, "SEPARATION_OF_DUTIES", "a different operator must verify or approve the destination")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different destination facts")
	default:
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "official wallet destination input is invalid")
	}
}

func writePayoutError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPartnerPayoutScopeRequired):
		writeError(w, http.StatusForbidden, "PARTNER_STORE_SCOPE_REQUIRED", "Partner payouts require Store-scoped payout requests")
	case errors.Is(err, postgres.ErrReverificationRequired):
		writeError(w, http.StatusConflict, "REVERIFICATION_REQUIRED", "current verified Identity facts do not match the active wallet destination")
	case errors.Is(err, postgres.ErrPayoutInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "payout intent input is invalid")
	case errors.Is(err, postgres.ErrCustomerWithdrawalNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "customer withdrawal intake was not found")
	case errors.Is(err, postgres.ErrCustomerWithdrawalState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "customer withdrawal intake state does not allow this operation")
	case errors.Is(err, postgres.ErrCustomerWithdrawalFunds):
		writeError(w, http.StatusConflict, "NO_ELIGIBLE_FUNDS", "customer has no eligible internal balance to withdraw")
	case errors.Is(err, postgres.ErrPayoutDestination):
		writeError(w, http.StatusConflict, "DESTINATION_UNAVAILABLE", "a verified active official wallet destination is required")
	case errors.Is(err, postgres.ErrPayoutNoFunds):
		writeError(w, http.StatusConflict, "NO_ELIGIBLE_FUNDS", "no eligible funds are available for settlement")
	case errors.Is(err, postgres.ErrPayoutAmountExceeded):
		writeError(w, http.StatusConflict, "AMOUNT_EXCEEDS_ELIGIBLE_FUNDS", "requested amount exceeds eligible funds")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different payout facts")
	default:
		var postgresError *pq.Error
		if errors.As(err, &postgresError) {
			log.Printf("WLT_PAYOUT_ERROR sqlstate=%s", postgresError.Code)
		} else {
			log.Printf("WLT_PAYOUT_ERROR error_type=%T", err)
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "payout operation could not be completed")
	}
}

func writePaymentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "payment intent was not found")
	case errors.Is(err, postgres.ErrExternalReferenceAmbiguous):
		writeError(w, http.StatusConflict, "EXTERNAL_REFERENCE_AMBIGUOUS", "more than one payment intent uses this external reference")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different payment facts")
	case errors.Is(err, postgres.ErrIntentExists):
		writeError(w, http.StatusConflict, "PAYMENT_EXISTS", "a payment intent already exists for this external reference")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "payment intent version is stale")
	case errors.Is(err, postgres.ErrStateConflict):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "payment intent state does not allow this operation")
	case errors.Is(err, postgres.ErrAmountMismatch):
		writeError(w, http.StatusBadRequest, "AMOUNT_MISMATCH", "collected amount must equal the payment intent amount")
	case errors.Is(err, postgres.ErrRemittanceExists):
		writeError(w, http.StatusConflict, "CASH_ALREADY_REMITTED", "cash for this payment intent was already remitted")
	case errors.Is(err, postgres.ErrRemittanceState):
		writeError(w, http.StatusConflict, "CASH_REMITTANCE_STATE_CONFLICT", "cash remittance is not awaiting Finance reconciliation")
	case errors.Is(err, postgres.ErrRemittanceSeparation):
		writeError(w, http.StatusForbidden, "CASH_REMITTANCE_SEPARATION_REQUIRED", "the Captain who submitted cash cannot reconcile it")
	case errors.Is(err, postgres.ErrRemittanceEvidence):
		writeError(w, http.StatusBadRequest, "CASH_REMITTANCE_EVIDENCE_REQUIRED", "Finance receipt evidence is required")
	case errors.Is(err, postgres.ErrRemittanceEvidenceUsed):
		writeError(w, http.StatusConflict, "FINANCE_EVIDENCE_ALREADY_LINKED", "the transfer receipt is already linked to another financial transfer")
	case errors.Is(err, postgres.ErrRemittanceIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different cash remittance facts")
	case errors.Is(err, postgres.ErrRemittanceInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cash remittance input is invalid")
	case errors.Is(err, postgres.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "payment input is invalid")
	case errors.Is(err, postgres.ErrCustomerPaymentAllocationInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_PAYMENT_ALLOCATION", "payment allocation is invalid")
	case errors.Is(err, postgres.ErrInsufficientCustomerBalance):
		writeError(w, http.StatusConflict, "INSUFFICIENT_CUSTOMER_BALANCE", "available customer balance does not cover the requested contribution")
	case errors.Is(err, postgres.ErrPartnerCommissionCreditExceeded):
		writeError(w, http.StatusConflict, "PARTNER_CREDIT_LIMIT", "new merchant cash commission exceeds the approved credit policy")
	case errors.Is(err, postgres.ErrStoreCommercialAgreementUnavailable):
		writeError(w, http.StatusConflict, "STORE_COMMERCIAL_AGREEMENT_REQUIRED", "an active Store-specific agreement is required for this fulfillment mode")
	default:
		log.Printf("WLT partner financial profile persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}

func writeDeliveryFeeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrDeliveryFeePolicyNotFound):
		writeError(w, http.StatusNotFound, "DELIVERY_FEE_POLICY_NOT_FOUND", "no active delivery fee policy is available")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different delivery fee policy facts")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "the active delivery fee policy changed after it was read")
	case errors.Is(err, postgres.ErrDeliveryOutsideCoverage):
		writeError(w, http.StatusUnprocessableEntity, "DELIVERY_OUTSIDE_SERVICE_AREA", "delivery distance exceeds the active service radius")
	case errors.Is(err, postgres.ErrDeliveryFeePolicyInvalidInput), errors.Is(err, postgres.ErrDeliveryFeeQuoteInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_DELIVERY_FEE", "delivery fee policy or quote is invalid")
	default:
		log.Printf("WLT delivery fee persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}

func toPartnerFinancialProfile(item postgres.PartnerFinancialProfileRecord) partnerFinancialProfileJSON {
	result := partnerFinancialProfileJSON{
		ID:                 item.ID,
		JoiningCaseID:      item.JoiningCaseID,
		PartnerActorID:     item.PartnerActorID,
		Origin:             item.Origin,
		SettlementPeriod:   item.SettlementPeriod,
		TermsPolicyVersion: item.TermsPolicyVersion,
		RoundingUnitMinor:  item.RoundingUnitMinor,
		State:              item.State,
		Version:            item.Version,
		CreatedAt:          item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"),
		UpdatedAt:          item.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"),
	}
	if item.ActivatedAt != nil {
		value := item.ActivatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.ActivatedAt = &value
	}
	return result
}

func writeFinancialProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrFinancialProfileNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "partner financial profile was not found")
	case errors.Is(err, postgres.ErrFinancialProfileExists):
		writeError(w, http.StatusConflict, "PROFILE_EXISTS", "partner financial profile already exists")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different financial profile facts")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "financial profile version is stale")
	case errors.Is(err, postgres.ErrFinancialProfileState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "financial profile state does not allow this operation")
	case errors.Is(err, postgres.ErrFinancialProfileInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "financial profile input is invalid")
	case errors.Is(err, postgres.ErrPartnerCommissionCreditExceeded):
		writeError(w, http.StatusConflict, "PARTNER_CREDIT_LIMIT", "new merchant cash commission exceeds the approved credit policy")
	case errors.Is(err, postgres.ErrStoreCommercialAgreementUnavailable):
		writeError(w, http.StatusConflict, "STORE_COMMERCIAL_AGREEMENT_REQUIRED", "an active Store-specific agreement is required for this fulfillment mode")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}

func toPartnerOrderEarning(item postgres.PartnerOrderEarningRecord) partnerOrderEarningJSON {
	return partnerOrderEarningJSON{OrderID: item.OrderID, PaymentIntentID: item.PaymentIntentID, PartnerActorID: item.PartnerActorID, CaptainActorID: item.CaptainActorID, Currency: item.Currency, GrossProductMinor: item.GrossProductMinor, DeliveryFeeMinor: item.DeliveryFeeMinor, CommissionMinor: item.CommissionMinor, PartnerNetMinor: item.PartnerNetMinor, CommissionReceivableOffsetMinor: item.CommissionReceivableOffsetMinor, ProfileID: item.ProfileID, ProfileVersion: item.ProfileVersion, PolicyVersion: item.PolicyVersion, LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
}

func toPartnerFinancialSummary(item postgres.PartnerFinancialSummaryRecord) partnerFinancialSummaryJSON {
	result := partnerFinancialSummaryJSON{SettledMinor: item.SettledMinor, EligibleAvailableMinor: item.EligibleAvailableMinor, HeldMinor: item.HeldMinor, PartnerActorID: item.PartnerActorID, Currency: item.Currency, EarnedMinor: item.EarnedMinor, CommissionMinor: item.CommissionMinor, OutstandingCommissionReceivableMinor: item.OutstandingCommissionReceivableMinor, OrderCount: item.OrderCount, SettlementPeriod: item.SettlementPeriod, ProfileState: item.ProfileState, ProfileVersion: item.ProfileVersion}
	if item.LastEarningAt != nil {
		value := item.LastEarningAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.LastEarningAt = &value
	}
	return result
}

func toPartnerStoreCashCommission(item postgres.PartnerStoreCashCommissionRecord) partnerStoreCashCommissionJSON {
	return partnerStoreCashCommissionJSON{OrderID: item.OrderID, PaymentIntentID: item.PaymentIntentID, PartnerActorID: item.PartnerActorID, FulfillmentMode: item.FulfillmentMode, Currency: item.Currency, GrossProductMinor: item.GrossProductMinor, CommissionMinor: item.CommissionMinor, ProfileID: item.ProfileID, ProfileVersion: item.ProfileVersion, PolicyVersion: item.PolicyVersion, LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano)}
}

func toPartnerCommissionRemittance(item postgres.PartnerCommissionRemittanceRecord) partnerCommissionRemittanceJSON {
	return partnerCommissionRemittanceJSON{ID: item.ID, PartnerActorID: item.PartnerActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, RemittanceReference: item.RemittanceReference, EvidenceReference: item.EvidenceReference, EvidenceDocumentID: item.EvidenceDocumentID, VerifiedBy: item.VerifiedBy, VerifiedAt: item.VerifiedAt.UTC().Format(time.RFC3339Nano), LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano)}
}

func writePartnerCashCommissionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPartnerCashCommissionInvalid), errors.Is(err, postgres.ErrPartnerRemittanceInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner commission receivable facts are invalid")
	case errors.Is(err, postgres.ErrPartnerCashCommissionState):
		writeError(w, http.StatusConflict, "STORE_CASH_PAYMENT_INVALID", "store cash payment is not collected by the specified Partner")
	case errors.Is(err, postgres.ErrPartnerCashCommissionExists):
		writeError(w, http.StatusConflict, "COMMISSION_EXISTS", "the store cash commission is already recorded")
	case errors.Is(err, postgres.ErrPartnerCommissionSnapshotMissing):
		writeError(w, http.StatusConflict, "COMMISSION_SNAPSHOT_MISSING", "this order has no immutable commission snapshot")
	case errors.Is(err, postgres.ErrPartnerRemittanceOverpayment):
		writeError(w, http.StatusConflict, "REMITTANCE_EXCEEDS_RECEIVABLE", "remittance exceeds the outstanding Partner commission receivable")
	case errors.Is(err, postgres.ErrPartnerRemittanceEvidence):
		writeError(w, http.StatusConflict, "REMITTANCE_EVIDENCE_INVALID", "a transfer receipt uploaded by the verifying Finance operator is required")
	case errors.Is(err, postgres.ErrPartnerRemittanceEvidenceUsed):
		writeError(w, http.StatusConflict, "FINANCE_EVIDENCE_ALREADY_LINKED", "the transfer receipt is already linked to another financial transfer")
	case errors.Is(err, postgres.ErrPartnerEarningProfile):
		writeError(w, http.StatusConflict, "PROFILE_NOT_ACTIVE", "an active Partner financial profile is required")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different Partner commission facts")
	case errors.Is(err, postgres.ErrLedgerUnbalanced):
		writeError(w, http.StatusConflict, "LEDGER_UNBALANCED", "the derived ledger transaction is not balanced")
	default:
		log.Printf("WLT Partner store cash commission persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT Partner commission persistence is unavailable")
	}
}

func writePartnerEarningError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPartnerEarningInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner earning input is invalid")
	case errors.Is(err, postgres.ErrCustomerPaymentAllocationNotFound), errors.Is(err, postgres.ErrPartnerEarningNotFound), errors.Is(err, postgres.ErrFinancialProfileNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "partner financial record was not found")
	case errors.Is(err, postgres.ErrPartnerEarningPaymentState):
		writeError(w, http.StatusConflict, "PAYMENT_NOT_COLLECTED", "partner earning requires a collected payment")
	case errors.Is(err, postgres.ErrPartnerEarningProfile):
		writeError(w, http.StatusConflict, "PROFILE_NOT_ACTIVE", "an active partner financial profile is required")
	case errors.Is(err, postgres.ErrPartnerCommissionSnapshotMissing):
		writeError(w, http.StatusConflict, "COMMISSION_SNAPSHOT_MISSING", "this order has no immutable commission snapshot")
	case errors.Is(err, postgres.ErrPartnerEarningExists):
		writeError(w, http.StatusConflict, "EARNING_EXISTS", "the order earning is already finalized")
	case errors.Is(err, postgres.ErrLedgerUnbalanced):
		writeError(w, http.StatusConflict, "LEDGER_UNBALANCED", "the derived ledger transaction is not balanced")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different partner earning facts")
	default:
		log.Printf("WLT partner earning persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
