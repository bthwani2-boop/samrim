package wallet

import (
	"context"
	"net/http"
	"strconv"
	"time"
)

type agreementProposalWire struct {
	ExpectedVersion        *int64    `json:"expectedVersion"`
	OperationID            string    `json:"operationId"`
	FeeModel               string    `json:"feeModel"`
	Collector              string    `json:"collector"`
	CommissionBasisPoints  *int32    `json:"commissionBasisPoints"`
	SubscriptionAmountYER  *string   `json:"subscriptionAmountYer"`
	SubscriptionPeriodDays *int32    `json:"subscriptionPeriodDays"`
	FulfillmentModes       []string  `json:"fulfillmentModes"`
	ProposedEffectiveAt    time.Time `json:"proposedEffectiveAt"`
	Reason                 string    `json:"reason"`
}

type agreementProposalHTTPReceipt struct {
	StoreID     string `json:"storeId"`
	Version     int64  `json:"version"`
	OperationID string `json:"operationId"`
	State       string `json:"state"`
}

type agreementProposalExecutor func(context.Context, string, AgreementProposal) (AgreementProposalReceipt, error)

func decodeAgreementProposal(w http.ResponseWriter, r *http.Request) (AgreementProposal, bool) {
	var wire agreementProposalWire
	if !decodeAgreementCommandBody(w, r, &wire) || wire.ExpectedVersion == nil {
		return AgreementProposal{}, false
	}
	var amount *int64
	if wire.SubscriptionAmountYER != nil {
		parsed, err := strconv.ParseInt(*wire.SubscriptionAmountYER, 10, 64)
		if err != nil || parsed < 1 || strconv.FormatInt(parsed, 10) != *wire.SubscriptionAmountYER {
			return AgreementProposal{}, false
		}
		amount = &parsed
	}
	return freezeAgreementProposal(AgreementProposal{
		StoreID: r.PathValue("storeID"), ExpectedVersion: *wire.ExpectedVersion, OperationID: wire.OperationID,
		FeeModel: wire.FeeModel, Collector: wire.Collector, CommissionBasisPoints: wire.CommissionBasisPoints,
		SubscriptionAmountYER: amount, SubscriptionPeriodDays: wire.SubscriptionPeriodDays, FulfillmentModes: wire.FulfillmentModes,
		ProposedEffectiveAt: wire.ProposedEffectiveAt, Reason: wire.Reason,
	})
}

func agreementProposalHandler(execute agreementProposalExecutor) http.HandlerFunc {
	return agreementCommandHandler("PROPOSAL_CONFLICT", "PROPOSAL_UNCONFIRMED", decodeAgreementProposal,
		func(ctx context.Context, token string, input AgreementProposal) (agreementProposalHTTPReceipt, error) {
			if execute == nil {
				return agreementProposalHTTPReceipt{}, ErrAgreementUnconfirmed
			}
			receipt, err := execute(ctx, token, input)
			if err != nil {
				return agreementProposalHTTPReceipt{}, err
			}
			if receipt.Version != input.ExpectedVersion+1 {
				return agreementProposalHTTPReceipt{}, ErrAgreementUnconfirmed
			}
			state := "RECORDED"
			if receipt.Replay {
				state = "REPLAYED"
			}
			return agreementProposalHTTPReceipt{StoreID: input.StoreID, Version: receipt.Version,
				OperationID: input.OperationID, State: state}, nil
		})
}
