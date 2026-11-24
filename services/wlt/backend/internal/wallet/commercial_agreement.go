package wallet

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"time"

	"github.com/lib/pq"
)

var storeIDRule = regexp.MustCompile("^[a-z0-9-]{1,64}$")

type agreementReader func(context.Context, string) (agreementResult, error)

type agreementResult struct {
	StoreID  string             `json:"storeId"`
	Proposal *agreementProposal `json:"proposal"`
}
type agreementProposal struct {
	Version                int64     `json:"version"`
	OperationID            string    `json:"operationId"`
	Relation               string    `json:"storeRelation"`
	FeeModel               string    `json:"feeModel"`
	Collector              string    `json:"collector"`
	Currency               string    `json:"currency"`
	CommissionBasisPoints  *int      `json:"commissionBasisPoints"`
	SubscriptionAmountYER  *string   `json:"subscriptionAmountYer"`
	SubscriptionPeriodDays *int      `json:"subscriptionPeriodDays"`
	FulfillmentModes       []string  `json:"fulfillmentModes"`
	ProposedEffectiveAt    time.Time `json:"proposedEffectiveAt"`
	ReviewState            string    `json:"reviewState"`
}

func readAgreement(ctx context.Context, db *sql.DB, store string) (agreementResult, error) {
	result := agreementResult{StoreID: store}
	var p agreementProposal
	err := db.QueryRowContext(ctx, `SELECT version,operation_id,store_relation,fee_model,collector,currency,
		commission_basis_points,subscription_amount_yer::text,subscription_period_days,
		fulfillment_modes,proposed_effective_at,review_state
		FROM wlt.latest_commercial_agreement_reviews WHERE store_id=$1`, store).
		Scan(&p.Version, &p.OperationID, &p.Relation, &p.FeeModel, &p.Collector, &p.Currency,
			&p.CommissionBasisPoints, &p.SubscriptionAmountYER, &p.SubscriptionPeriodDays,
			pq.Array(&p.FulfillmentModes), &p.ProposedEffectiveAt, &p.ReviewState)
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	p.ProposedEffectiveAt = p.ProposedEffectiveAt.UTC()
	result.Proposal = &p
	return result, nil
}
