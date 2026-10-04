package joiningcase

import (
	"context"
	"strings"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type FinanceStoreCommercialAgreement struct {
	wltintegration.StoreCommercialAgreement
	StoreName                      string   `json:"storeName"`
	CommercialStoreTypeID          string   `json:"commercialStoreTypeId"`
	FulfillmentModes               []string `json:"fulfillmentModes"`
	CurrentStoreOwnerActorID       string   `json:"currentStoreOwnerActorId"`
	MatchesCurrentFulfillmentModes bool     `json:"matchesCurrentFulfillmentModes"`
}

type FinanceStoreCommercialAgreementPage struct {
	Agreements []FinanceStoreCommercialAgreement `json:"agreements"`
	NextCursor string                            `json:"nextCursor,omitempty"`
}

func (s *Service) ListPartnerAcceptedStoreCommercialAgreementsForFinance(ctx context.Context, cursor string, limit int, actingActorID string) (FinanceStoreCommercialAgreementPage, error) {
	if err := s.requireFinance(ctx, actingActorID); err != nil {
		return FinanceStoreCommercialAgreementPage{}, err
	}
	cursor = strings.TrimSpace(cursor)
	if len(cursor) > 1024 || limit < 1 || limit > 50 {
		return FinanceStoreCommercialAgreementPage{}, ErrStoreAgreementInvalidInput
	}
	page, err := s.wlt.ListPartnerAcceptedStoreCommercialAgreements(ctx, cursor, limit)
	if err != nil {
		return FinanceStoreCommercialAgreementPage{}, err
	}
	result := FinanceStoreCommercialAgreementPage{Agreements: make([]FinanceStoreCommercialAgreement, 0, len(page.Agreements)), NextCursor: page.NextCursor}
	for _, agreement := range page.Agreements {
		if agreement.Status != "PARTNER_ACCEPTED" || strings.TrimSpace(agreement.AgreementID) == "" || strings.TrimSpace(agreement.StoreID) == "" || strings.TrimSpace(agreement.PartnerActorID) == "" {
			return FinanceStoreCommercialAgreementPage{}, ErrStoreAgreementState
		}
		store, err := postgres.ReadStore(ctx, s.db, agreement.StoreID)
		if err != nil {
			return FinanceStoreCommercialAgreementPage{}, err
		}
		if store.ID != agreement.StoreID {
			return FinanceStoreCommercialAgreementPage{}, postgres.ErrStoreNotFound
		}
		_, modeErr := normalizeStoreAgreementRates(store.FulfillmentModes, agreement.Rates)
		result.Agreements = append(result.Agreements, FinanceStoreCommercialAgreement{
			StoreCommercialAgreement: agreement,
			StoreName:                store.Name, CommercialStoreTypeID: store.CommercialStoreTypeID,
			FulfillmentModes: append([]string(nil), store.FulfillmentModes...), CurrentStoreOwnerActorID: store.PartnerActorID,
			MatchesCurrentFulfillmentModes: modeErr == nil && store.PartnerActorID == agreement.PartnerActorID,
		})
	}
	return result, nil
}
