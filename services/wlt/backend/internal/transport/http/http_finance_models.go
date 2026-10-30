package http

import "strings"

type officialWalletDestinationResponse struct {
	Destination      officialWalletDestinationJSON `json:"destination"`
	IdempotentReplay bool                          `json:"idempotentReplay,omitempty"`
}

type officialWalletDestinationJSON struct {
	ID                            string  `json:"id"`
	ActorType                     string  `json:"actorType"`
	ActorID                       string  `json:"actorId"`
	ProviderKey                   string  `json:"providerKey"`
	WalletIdentifierMasked        string  `json:"walletIdentifierMasked"`
	BeneficiaryName               string  `json:"beneficiaryName"`
	BeneficiaryIdentityVersion    int     `json:"beneficiaryIdentityVersion"`
	VerificationStatus            string  `json:"verificationStatus"`
	Status                        string  `json:"status"`
	Version                       int     `json:"version"`
	ChangeReason                  string  `json:"changeReason"`
	SubmittedBy                   string  `json:"submittedBy"`
	SubmittedAt                   string  `json:"submittedAt"`
	VerifiedBy                    *string `json:"verifiedBy"`
	VerifiedAt                    *string `json:"verifiedAt"`
	ApprovedBy                    *string `json:"approvedBy"`
	ApprovedAt                    *string `json:"approvedAt"`
	VerificationEvidenceReference string  `json:"verificationEvidenceReference"`
	ChangeEvidenceReference       string  `json:"changeEvidenceReference"`
	CreatedAt                     string  `json:"createdAt"`
	UpdatedAt                     string  `json:"updatedAt"`
}

type payoutRequestResponse struct {
	Payout           payoutRequestJSON `json:"payout"`
	IdempotentReplay bool              `json:"idempotentReplay"`
}

type payoutRequestJSON struct {
	BeneficiaryActorID   string `json:"beneficiaryActorId"`
	ID                   string `json:"id"`
	ActorType            string `json:"actorType"`
	ActorID              string `json:"actorId"`
	AmountMode           string `json:"amountMode"`
	RequestedAmountMinor *int64 `json:"requestedAmountMinor"`
	ResolvedAmountMinor  int64  `json:"resolvedAmountMinor"`
	Currency             string `json:"currency"`
	DestinationID        string `json:"destinationId"`
	DestinationVersion   int    `json:"destinationVersion"`
	Status               string `json:"status"`
	PolicyVersion        string `json:"policyVersion"`
	LedgerTransactionID  string `json:"ledgerTransactionId,omitempty"`
	CreatedAt            string `json:"createdAt"`
}

type payoutStateResponse struct {
	State payoutStateJSON `json:"state"`
}

type payoutStateJSON struct {
	ActorType              string                         `json:"actorType"`
	ActorID                string                         `json:"actorId"`
	Currency               string                         `json:"currency"`
	EligibleAvailableMinor int64                          `json:"eligibleAvailableMinor"`
	HeldMinor              int64                          `json:"heldMinor"`
	AcquiredStoreCount     *int64                         `json:"acquiredStoreCount,omitempty"`
	EarnedMinor            *int64                         `json:"earnedMinor,omitempty"`
	Destination            *officialWalletDestinationJSON `json:"destination"`
	LatestPayout           *payoutRequestJSON             `json:"latestPayout"`
}

type beneficiaryPayoutRegistryResponse struct {
	Beneficiaries []payoutStateJSON `json:"beneficiaries"`
	NextCursor    string            `json:"nextCursor,omitempty"`
	Limit         int               `json:"limit"`
}

type fieldFinanceAggregateJSON struct {
	Currency               string `json:"currency"`
	FieldActorCount        int64  `json:"fieldActorCount"`
	AcquiredStoreCount     int64  `json:"acquiredStoreCount"`
	EarnedMinor            int64  `json:"earnedMinor"`
	EligibleAvailableMinor int64  `json:"eligibleAvailableMinor"`
	HeldMinor              int64  `json:"heldMinor"`
	PayoutRequestCount     int64  `json:"payoutRequestCount"`
	ActiveDestinationCount int64  `json:"activeDestinationCount"`
}

type fieldPayoutStatesBatchRequest struct {
	ActorIDs []string `json:"actorIds"`
}

type fieldPayoutStatesBatchResponse struct {
	Beneficiaries       []payoutStateJSON         `json:"beneficiaries"`
	FieldFinanceSummary fieldFinanceAggregateJSON `json:"fieldFinanceSummary"`
}

func normalizeFieldPayoutBatchActorIDs(rawActorIDs []string) ([]string, bool) {
	if len(rawActorIDs) > 100 {
		return nil, false
	}
	actorIDs := make([]string, 0, len(rawActorIDs))
	seen := make(map[string]struct{}, len(rawActorIDs))
	for _, rawActorID := range rawActorIDs {
		actorID := strings.TrimSpace(rawActorID)
		if actorID == "" || len(actorID) > 128 {
			return nil, false
		}
		if _, exists := seen[actorID]; exists {
			continue
		}
		seen[actorID] = struct{}{}
		actorIDs = append(actorIDs, actorID)
	}
	return actorIDs, true
}

type beneficiaryPayoutRegistryCursor struct {
	Sort      string `json:"sort"`
	SortValue int64  `json:"sortValue"`
	ActorType string `json:"actorType"`
	ActorID   string `json:"actorId"`
}

type partnerOrderEarningResponse struct {
	Earning          partnerOrderEarningJSON `json:"earning"`
	IdempotentReplay bool                    `json:"idempotentReplay"`
}

type partnerStoreCashCommissionResponse struct {
	Commission       partnerStoreCashCommissionJSON `json:"commission"`
	IdempotentReplay bool                           `json:"idempotentReplay"`
}

type partnerStoreCashCommissionJSON struct {
	OrderID             string `json:"orderId"`
	PaymentIntentID     string `json:"paymentIntentId"`
	PartnerActorID      string `json:"partnerActorId"`
	FulfillmentMode     string `json:"fulfillmentMode"`
	Currency            string `json:"currency"`
	GrossProductMinor   int64  `json:"grossProductMinor"`
	CommissionMinor     int64  `json:"commissionMinor"`
	ProfileID           string `json:"profileId"`
	ProfileVersion      int    `json:"profileVersion"`
	PolicyVersion       string `json:"policyVersion"`
	LedgerTransactionID string `json:"ledgerTransactionId,omitempty"`
	CreatedAt           string `json:"createdAt"`
}

type partnerCommissionRemittanceResponse struct {
	Remittance       partnerCommissionRemittanceJSON `json:"remittance"`
	IdempotentReplay bool                            `json:"idempotentReplay"`
}

type partnerCommissionRemittanceJSON struct {
	ID                  string `json:"id"`
	PartnerActorID      string `json:"partnerActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	RemittanceReference string `json:"remittanceReference"`
	EvidenceReference   string `json:"evidenceReference,omitempty"`
	EvidenceDocumentID  string `json:"evidenceDocumentId,omitempty"`
	VerifiedBy          string `json:"verifiedBy"`
	VerifiedAt          string `json:"verifiedAt"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}

type partnerOrderEarningJSON struct {
	OrderID                         string `json:"orderId"`
	PaymentIntentID                 string `json:"paymentIntentId"`
	PartnerActorID                  string `json:"partnerActorId"`
	CaptainActorID                  string `json:"captainActorId"`
	Currency                        string `json:"currency"`
	GrossProductMinor               int64  `json:"grossProductMinor"`
	DeliveryFeeMinor                int64  `json:"deliveryFeeMinor"`
	CommissionMinor                 int64  `json:"commissionMinor"`
	PartnerNetMinor                 int64  `json:"partnerNetMinor"`
	CommissionReceivableOffsetMinor int64  `json:"commissionReceivableOffsetMinor"`
	ProfileID                       string `json:"profileId"`
	ProfileVersion                  int    `json:"profileVersion"`
	PolicyVersion                   string `json:"policyVersion"`
	LedgerTransactionID             string `json:"ledgerTransactionId"`
	CreatedAt                       string `json:"createdAt"`
}

type partnerFinancialSummaryResponse struct {
	Summary partnerFinancialSummaryJSON `json:"summary"`
}

type fieldAcquisitionRewardPolicyResponse struct {
	Policy           fieldAcquisitionRewardPolicyJSON `json:"policy"`
	IdempotentReplay bool                             `json:"idempotentReplay,omitempty"`
}

type fieldAcquisitionRewardPolicyJSON struct {
	ID                string  `json:"id"`
	ScopeType         string  `json:"scopeType"`
	ScopeID           string  `json:"scopeId"`
	RewardMinor       int64   `json:"rewardMinor"`
	RoundingUnitMinor int64   `json:"roundingUnitMinor"`
	State             string  `json:"state"`
	Version           int     `json:"version"`
	CreatedBy         string  `json:"createdBy"`
	CreatedAt         string  `json:"createdAt"`
	RetiredAt         *string `json:"retiredAt"`
}

type fieldAcquisitionEntitlementResponse struct {
	Entitlement      fieldAcquisitionEntitlementJSON `json:"entitlement"`
	IdempotentReplay bool                            `json:"idempotentReplay"`
}

type fieldAcquisitionEntitlementJSON struct {
	JoiningCaseID         string `json:"joiningCaseId"`
	StoreID               string `json:"storeId"`
	PartnerActorID        string `json:"partnerActorId"`
	FieldActorID          string `json:"fieldActorId"`
	VerticalID            string `json:"verticalId"`
	CommercialStoreTypeID string `json:"commercialStoreTypeId"`
	PolicyID              string `json:"policyId"`
	PolicyVersion         int    `json:"policyVersion"`
	RewardMinor           int64  `json:"rewardMinor"`
	Currency              string `json:"currency"`
	LedgerTransactionID   string `json:"ledgerTransactionId"`
	CreatedAt             string `json:"createdAt"`
	EffectiveAt           string `json:"effectiveAt"`
	Status                string `json:"status"`
}

type fieldFinancialSummaryResponse struct {
	Summary fieldFinancialSummaryJSON `json:"summary"`
}

type fieldFinancialSummaryJSON struct {
	FieldActorID     string  `json:"fieldActorId"`
	Currency         string  `json:"currency"`
	EarnedMinor      int64   `json:"earnedMinor"`
	EntitlementMinor int64   `json:"entitlementMinor"`
	PartnerCount     int64   `json:"partnerCount"`
	LastEarningAt    *string `json:"lastEarningAt"`
}
