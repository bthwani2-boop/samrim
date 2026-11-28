package wallet

import (
	"context"
	"database/sql"
	"slices"
	"time"

	"github.com/lib/pq"
)

// AgreementProposal is an immutable retry payload for proposed terms.
// WLT obtains the actor and Store relation at the owner boundary.
type AgreementProposal struct {
	StoreID                string
	ExpectedVersion        int64
	OperationID            string
	FeeModel               string
	Collector              string
	CommissionBasisPoints  *int32
	SubscriptionAmountYER  *int64
	SubscriptionPeriodDays *int32
	FulfillmentModes       []string
	ProposedEffectiveAt    time.Time
	Reason                 string
}

type AgreementProposalReceipt struct {
	Version int64
	Replay  bool
}

func freezeAgreementProposal(input AgreementProposal) (AgreementProposal, bool) {
	if !storeIDRule.MatchString(input.StoreID) || !agreementOperationID.MatchString(input.OperationID) ||
		input.ExpectedVersion < 0 || input.ExpectedVersion >= 9007199254740991 ||
		(input.Collector != "PLATFORM_MANAGED" && input.Collector != "STORE_MANAGED") ||
		!validAgreementReason(input.Reason) || len(input.FulfillmentModes) < 1 || len(input.FulfillmentModes) > 3 {
		return AgreementProposal{}, false
	}
	input.ProposedEffectiveAt = input.ProposedEffectiveAt.UTC()
	// PostgreSQL stores microseconds. Reject a timestamp that would be
	// rounded before comparison with a future replay of the original input.
	at := input.ProposedEffectiveAt
	if at.IsZero() || at.Year() < 1 || at.Year() > 9999 || at.Nanosecond()%1000 != 0 {
		return AgreementProposal{}, false
	}
	input.FulfillmentModes = slices.Clone(input.FulfillmentModes)
	seen := make(map[string]bool, len(input.FulfillmentModes))
	for _, mode := range input.FulfillmentModes {
		if seen[mode] || (mode != "BTHWANI_CAPTAIN" && mode != "PARTNER_CAPTAIN" && mode != "CUSTOMER_PICKUP") {
			return AgreementProposal{}, false
		}
		seen[mode] = true
	}
	switch input.FeeModel {
	case "COMMISSION":
		if input.CommissionBasisPoints == nil || input.SubscriptionAmountYER != nil || input.SubscriptionPeriodDays != nil {
			return AgreementProposal{}, false
		}
		points := *input.CommissionBasisPoints
		if points < 0 || points > 10000 {
			return AgreementProposal{}, false
		}
		input.CommissionBasisPoints = &points
	case "SUBSCRIPTION":
		if input.CommissionBasisPoints != nil || input.SubscriptionAmountYER == nil || input.SubscriptionPeriodDays == nil {
			return AgreementProposal{}, false
		}
		amount, period := *input.SubscriptionAmountYER, *input.SubscriptionPeriodDays
		if amount < 1 || period < 1 {
			return AgreementProposal{}, false
		}
		input.SubscriptionAmountYER, input.SubscriptionPeriodDays = &amount, &period
	default:
		return AgreementProposal{}, false
	}
	return input, true
}

// RecordFinanceAgreementProposal appends proposed terms for a current
// Finance Operator and an existing Store. Consent, review and activation
// follow separate WLT transitions.
func RecordFinanceAgreementProposal(ctx context.Context, db *sql.DB, identityOrigin, dshOrigin, token string, input AgreementProposal) (AgreementProposalReceipt, error) {
	proposal, valid := freezeAgreementProposal(input)
	if db == nil || !valid {
		return AgreementProposalReceipt{}, ErrAgreementInvalid
	}
	authority, err := agreementCommandAuthority(identityOrigin, dshOrigin, token, proposal.StoreID, financeStage)
	if err != nil {
		return AgreementProposalReceipt{}, err
	}
	return executeAgreementCommand(ctx, db, authority, func(ctx context.Context, tx *sql.Tx, actor principal, standing financialStanding) (AgreementProposalReceipt, error) {
		var receipt AgreementProposalReceipt
		err := tx.QueryRowContext(ctx, `SELECT version,replay FROM
			wlt.append_commercial_agreement_proposal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			proposal.StoreID, proposal.ExpectedVersion, proposal.OperationID, standing.Relation,
			proposal.FeeModel, proposal.Collector, proposal.CommissionBasisPoints, proposal.SubscriptionAmountYER,
			proposal.SubscriptionPeriodDays, pq.Array(proposal.FulfillmentModes), proposal.ProposedEffectiveAt,
			actor.ActorID, proposal.Reason).Scan(&receipt.Version, &receipt.Replay)
		if err != nil {
			return AgreementProposalReceipt{}, agreementWriteError(err)
		}
		if receipt.Version != proposal.ExpectedVersion+1 {
			return AgreementProposalReceipt{}, ErrAgreementUnconfirmed
		}
		return receipt, nil
	})
}
