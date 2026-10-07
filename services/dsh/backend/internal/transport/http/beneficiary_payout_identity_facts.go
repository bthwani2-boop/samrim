package transporthttp

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

type payoutBeneficiary struct {
	actorType string
	actorID   string
}

func (s *BeneficiaryFinanceServer) currentFactsForPayout(ctx context.Context, payout wlt.PayoutRequest, actingOperatorID string) (wlt.IdentityFacts, error) {
	return s.readCurrentOfficialWalletIdentityFacts(ctx, payout.ActorType, payout.BeneficiaryActorID, actingOperatorID)
}

func (s *BeneficiaryFinanceServer) currentFactsForBatch(ctx context.Context, items []wlt.SettlementBatchItem, actingOperatorID string) ([]wlt.IdentityFacts, error) {
	beneficiaries := make(map[string]payoutBeneficiary, len(items))
	for _, item := range items {
		actorType := strings.ToLower(strings.TrimSpace(item.ActorType))
		actorID := strings.TrimSpace(item.ActorID)
		if actorType == "" || actorID == "" {
			return nil, fmt.Errorf("settlement batch beneficiary is invalid")
		}
		key := actorType + "\x00" + actorID
		beneficiaries[key] = payoutBeneficiary{actorType: actorType, actorID: actorID}
	}
	keys := make([]string, 0, len(beneficiaries))
	for key := range beneficiaries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	facts := make([]wlt.IdentityFacts, 0, len(keys))
	for _, key := range keys {
		beneficiary := beneficiaries[key]
		item, err := s.readCurrentOfficialWalletIdentityFacts(ctx, beneficiary.actorType, beneficiary.actorID, actingOperatorID)
		if err != nil {
			return nil, err
		}
		facts = append(facts, item)
	}
	if len(facts) == 0 {
		return nil, fmt.Errorf("settlement batch has no beneficiaries")
	}
	return facts, nil
}
