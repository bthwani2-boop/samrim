package financialhandoff

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type Service struct {
	db  *sql.DB
	wlt *wltintegration.Client
}

func New(db *sql.DB, wlt *wltintegration.Client) (*Service, error) {
	if db == nil || wlt == nil {
		return nil, errors.New("financial handoff configuration is invalid")
	}
	return &Service{db: db, wlt: wlt}, nil
}

func (s *Service) Reconcile(ctx context.Context) error {
	items, err := postgres.ListPendingFinancialHandoffs(ctx, s.db, 100)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := s.apply(ctx, item); err != nil {
			if markErr := postgres.MarkFinancialHandoffFailure(ctx, s.db, item.ID, err.Error()); markErr != nil {
				return markErr
			}
			continue
		}
		if err := postgres.MarkFinancialHandoffPosted(ctx, s.db, item); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) apply(ctx context.Context, item postgres.FinancialHandoffOutbox) error {
	switch item.EffectType {
	case "DELIVERY_SETTLEMENT":
		payable, cashAmount, err := postgres.ReadOrderPaymentAmounts(ctx, s.db, item.OrderID, item.PaymentIntentID)
		if err != nil {
			return fmt.Errorf("read DSH delivery payment allocation: %w", err)
		}
		if cashAmount != item.AmountMinor {
			return errors.New("DSH delivery outbox cash amount differs from the order payment allocation")
		}
		intent, err := s.wlt.EnsureCollected(ctx, item.PaymentIntentID, item.CaptainActorID, wltintegration.DerivedExternalReference("cash", item.IdempotencyKey), payable, wltintegration.DerivedIdempotencyKey("collect", item.IdempotencyKey), item.CorrelationID)
		if err != nil {
			return fmt.Errorf("collect COD: %w", err)
		}
		if intent.State != "COLLECTED" {
			return errors.New("WLT collection did not reach COLLECTED")
		}
		if cashAmount > 0 {
			if _, _, err := s.wlt.FinalizeCaptainCOD(ctx, item.OrderID, item.PaymentIntentID, item.CaptainActorID, wltintegration.DerivedIdempotencyKey("captain-cod-finalize", item.SourceRef), item.CorrelationID); err != nil {
				return fmt.Errorf("finalize captain COD: %w", err)
			}
		}
		if _, _, err := s.wlt.FinalizePartnerOrderEarning(ctx, item.OrderID, item.PaymentIntentID, item.PartnerActorID, item.CaptainActorID, wltintegration.DerivedIdempotencyKey("partner-earning", item.OrderID), item.CorrelationID); err != nil {
			return fmt.Errorf("finalize partner earning: %w", err)
		}
		return nil
	case "STORE_PICKUP_COLLECTION":
		payable, cashAmount, err := postgres.ReadOrderPaymentAmounts(ctx, s.db, item.OrderID, item.PaymentIntentID)
		if err != nil {
			return fmt.Errorf("read DSH pickup payment allocation: %w", err)
		}
		if cashAmount != item.AmountMinor {
			return errors.New("DSH pickup outbox cash amount differs from the order payment allocation")
		}
		intent, err := s.wlt.EnsureCollected(ctx, item.PaymentIntentID, item.PartnerActorID, wltintegration.DerivedExternalReference("store-pickup-cash", item.IdempotencyKey), payable, wltintegration.DerivedIdempotencyKey("store-pickup-collect", item.IdempotencyKey), item.CorrelationID)
		if err != nil {
			return fmt.Errorf("collect store pickup cash: %w", err)
		}
		if intent.State != "COLLECTED" || intent.Method != wltintegration.MethodCashAtStore || !collectionActorMatches(intent, item.PartnerActorID, cashAmount) {
			return errors.New("WLT store pickup collection does not match the Partner cash collection")
		}
		if _, _, err := s.wlt.FinalizePartnerStoreCashCommission(ctx, item.OrderID, item.PaymentIntentID, item.PartnerActorID, "CUSTOMER_PICKUP", wltintegration.DerivedIdempotencyKey("store-pickup-commission", item.OrderID), item.CorrelationID); err != nil {
			return fmt.Errorf("recognize Partner store pickup commission: %w", err)
		}
		return nil
	case "PARTNER_CAPTAIN_STORE_CASH_COLLECTION":
		payable, cashAmount, err := postgres.ReadOrderPaymentAmounts(ctx, s.db, item.OrderID, item.PaymentIntentID)
		if err != nil {
			return fmt.Errorf("read DSH Store Captain payment allocation: %w", err)
		}
		if cashAmount != item.AmountMinor || cashAmount == 0 {
			return errors.New("DSH Store Captain outbox must match a positive cash allocation")
		}
		intent, err := s.wlt.EnsureCollected(ctx, item.PaymentIntentID, item.PartnerActorID, wltintegration.DerivedExternalReference("store-captain-cash", item.IdempotencyKey), payable, wltintegration.DerivedIdempotencyKey("store-captain-cash-collect", item.IdempotencyKey), item.CorrelationID)
		if err != nil {
			return fmt.Errorf("collect Store Captain cash handoff: %w", err)
		}
		if intent.State != "COLLECTED" || intent.Method != wltintegration.MethodCashAtStore || !collectionActorMatches(intent, item.PartnerActorID, cashAmount) {
			return errors.New("WLT Store Captain collection does not match the Store cash handoff")
		}
		if _, _, err := s.wlt.FinalizePartnerStoreCashCommission(ctx, item.OrderID, item.PaymentIntentID, item.PartnerActorID, "PARTNER_CAPTAIN", wltintegration.DerivedIdempotencyKey("store-captain-commission", item.OrderID), item.CorrelationID); err != nil {
			return fmt.Errorf("recognize Partner Store Captain commission: %w", err)
		}
		return nil
	case "PARTNER_CAPTAIN_BALANCE_SETTLEMENT":
		payable, cashAmount, err := postgres.ReadOrderPaymentAmounts(ctx, s.db, item.OrderID, item.PaymentIntentID)
		if err != nil {
			return fmt.Errorf("read DSH Store Captain balance allocation: %w", err)
		}
		if cashAmount != 0 || item.AmountMinor != 0 {
			return errors.New("DSH Store Captain balance settlement requires a zero cash allocation")
		}
		intent, err := s.wlt.EnsureCollected(ctx, item.PaymentIntentID, "", "", payable, wltintegration.DerivedIdempotencyKey("store-captain-balance-settle", item.IdempotencyKey), item.CorrelationID)
		if err != nil {
			return fmt.Errorf("settle Store Captain payment from customer balance: %w", err)
		}
		if intent.State != "COLLECTED" || intent.Method != wltintegration.MethodCashAtStore || !collectionActorMatches(intent, "", 0) {
			return errors.New("WLT Store Captain balance settlement does not match the allocated source")
		}
		if _, _, err := s.wlt.FinalizePartnerStoreCashCommission(ctx, item.OrderID, item.PaymentIntentID, item.PartnerActorID, "PARTNER_CAPTAIN", wltintegration.DerivedIdempotencyKey("store-captain-commission", item.OrderID), item.CorrelationID); err != nil {
			return fmt.Errorf("recognize Partner Store Captain commission: %w", err)
		}
		return nil
	case "CAPTAIN_COD_RELEASE":
		if _, _, err := s.wlt.ReleaseCaptainCOD(ctx, item.OrderID, item.PaymentIntentID, item.CaptainActorID, wltintegration.DerivedIdempotencyKey("captain-cod-release-reassign", item.IdempotencyKey), item.CorrelationID); err != nil {
			var wltErr *wltintegration.Error
			if errors.As(err, &wltErr) && wltErr.Status == 404 && wltErr.Code == "NOT_FOUND" {
				return nil
			}
			return fmt.Errorf("release captain COD: %w", err)
		}
		return nil
	case "PAYMENT_CANCEL":
		prefix := "cancel"
		if item.Reason == "client_cancelled" {
			prefix = "cancel-client"
		}
		if _, err := s.wlt.EnsureCancelled(ctx, item.PaymentIntentID, item.Reason, wltintegration.DerivedIdempotencyKey(prefix, item.IdempotencyKey), item.CorrelationID); err != nil {
			return fmt.Errorf("cancel payment intent: %w", err)
		}
		return nil
	default:
		return errors.New("unknown financial handoff effect")
	}
}

func collectionActorMatches(intent wltintegration.PaymentIntent, actorID string, cashAmountMinor int64) bool {
	if cashAmountMinor == 0 {
		return intent.CollectedByActorID == nil || strings.TrimSpace(*intent.CollectedByActorID) == ""
	}
	return intent.CollectedByActorID != nil && strings.TrimSpace(*intent.CollectedByActorID) == strings.TrimSpace(actorID)
}
