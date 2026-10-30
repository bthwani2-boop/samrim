package wlt

type DeliveryDistanceBand struct {
	UpToMeters     *int64 `json:"upToMeters"`
	RatePerKmMinor int64  `json:"ratePerKmMinor"`
}
type DeliveryFeePolicy struct {
	DistanceBands          []DeliveryDistanceBand `json:"distanceBands"`
	ID                     string                 `json:"id"`
	ServiceCityID          string                 `json:"serviceCityId"`
	PolicyVersion          string                 `json:"policyVersion"`
	State                  string                 `json:"state"`
	BaseFeeMinor           int64                  `json:"baseFeeMinor"`
	DistanceUnitMeters     int64                  `json:"distanceUnitMeters"`
	DistanceRateMinor      int64                  `json:"distanceRateMinor"`
	OrderSizeUnitBaseUnits int64                  `json:"orderSizeUnitBaseUnits"`
	OrderSizeRateMinor     int64                  `json:"orderSizeRateMinor"`
	ZoneSurchargeMinor     int64                  `json:"zoneSurchargeMinor"`
	RoundingUnitMinor      int64                  `json:"roundingUnitMinor"`
	Version                int                    `json:"version"`
	CreatedBy              string                 `json:"createdBy"`
	CreatedAt              string                 `json:"createdAt"`
	RetiredAt              *string                `json:"retiredAt"`
}

type PartnerFinancialTermsPolicy struct {
	ID               string  `json:"id"`
	PolicyVersion    string  `json:"policyVersion"`
	State            string  `json:"state"`
	SettlementPeriod string  `json:"settlementPeriod"`
	Version          int     `json:"version"`
	CreatedBy        string  `json:"createdBy"`
	CreatedAt        string  `json:"createdAt"`
	RetiredAt        *string `json:"retiredAt"`
}

type DeliveryFeeQuote struct {
	CaptainEarningMinor int64  `json:"captainEarningMinor"`
	PlatformMarginMinor int64  `json:"platformMarginMinor"`
	FeeMinor            int64  `json:"feeMinor"`
	PolicyVersion       string `json:"policyVersion"`
	ServiceCityID       string `json:"serviceCityId"`
	DistanceMeters      int64  `json:"distanceMeters"`
	DistanceUnits       int64  `json:"distanceUnits"`
	OrderSizeBaseUnits  int64  `json:"orderSizeBaseUnits"`
	OrderSizeUnits      int64  `json:"orderSizeUnits"`
	RoundingUnitMinor   int64  `json:"roundingUnitMinor"`
}

type DeliveryFeeQuoteInput struct {
	StoreID              string  `json:"storeId"`
	FulfillmentMode      string  `json:"fulfillmentMode"`
	ServiceCityID        string  `json:"serviceCityId"`
	OriginLatitude       float64 `json:"originLatitude"`
	OriginLongitude      float64 `json:"originLongitude"`
	DestinationLatitude  float64 `json:"destinationLatitude"`
	DestinationLongitude float64 `json:"destinationLongitude"`
	OrderSizeBaseUnits   int64   `json:"orderSizeBaseUnits"`
}

type cashRemittanceResponse struct {
	CashRemittance   CashRemittance `json:"cashRemittance"`
	IdempotentReplay bool           `json:"idempotentReplay"`
}

type partnerFinancialProfileResponse struct {
	Profile          PartnerFinancialProfile `json:"profile"`
	IdempotentReplay bool                    `json:"idempotentReplay"`
}

type partnerOrderEarningResponse struct {
	Earning          PartnerOrderEarning `json:"earning"`
	IdempotentReplay bool                `json:"idempotentReplay"`
}

type partnerFinancialSummaryResponse struct {
	Summary PartnerFinancialSummary `json:"summary"`
}

type fieldAcquisitionRewardPolicyResponse struct {
	Policy           FieldAcquisitionRewardPolicy `json:"policy"`
	IdempotentReplay bool                         `json:"idempotentReplay"`
}

type fieldAcquisitionEntitlementResponse struct {
	Entitlement      FieldAcquisitionEntitlement `json:"entitlement"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

type fieldAcquisitionEntitlementReadbackResponse struct {
	Entitlement FieldAcquisitionEntitlementReadback `json:"entitlement"`
}

type fieldFinancialSummaryResponse struct {
	Summary FieldFinancialSummary `json:"summary"`
}

type officialWalletDestinationResponse struct {
	Destination      OfficialWalletDestination `json:"destination"`
	IdempotentReplay bool                      `json:"idempotentReplay"`
}

type payoutRequestResponse struct {
	Payout           PayoutRequest `json:"payout"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}

type payoutStateResponse struct {
	State PayoutState `json:"state"`
}

type payoutListResponse struct {
	Payouts []PayoutRequest `json:"payouts"`
}

type settlementBatchResponse struct {
	Batch SettlementBatch `json:"batch"`
}

type transferResponse struct {
	Transfer ManualTransferExecution `json:"transfer"`
}

type deliveryFeePolicyResponse struct {
	Policy           DeliveryFeePolicy `json:"policy"`
	IdempotentReplay bool              `json:"idempotentReplay"`
}

type partnerFinancialTermsPolicyResponse struct {
	Policy           PartnerFinancialTermsPolicy `json:"policy"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

type deliveryFeeQuoteResponse struct {
	Quote DeliveryFeeQuote `json:"quote"`
}
