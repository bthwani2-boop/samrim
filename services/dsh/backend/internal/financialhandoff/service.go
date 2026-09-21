package financialhandoff

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type Service struct {
	db  *sql.DB
	wlt *wltintegration.Client
}

func New(db *sql.DB, wlt *wltintegration.Client) (*Service,error) {
	if db==nil || wlt==nil { return nil,errors.New("financial handoff configuration is invalid") }
	return &Service{db:db,wlt:wlt},nil
}

func (s *Service) Reconcile(ctx context.Context) error {
	items,err:=postgres.ListPendingFinancialHandoffs(ctx,s.db,100)
	if err!=nil{return err}
	for _,item:=range items {
		if err:=s.apply(ctx,item);err!=nil{
			if markErr:=postgres.MarkFinancialHandoffFailure(ctx,s.db,item.ID,err.Error());markErr!=nil{return markErr}
			continue
		}
		if err:=postgres.MarkFinancialHandoffPosted(ctx,s.db,item);err!=nil{return err}
	}
	return nil
}

func (s *Service) apply(ctx context.Context,item postgres.FinancialHandoffOutbox) error {
	switch item.EffectType {
	case "DELIVERY_SETTLEMENT":
		intent,err:=s.wlt.EnsureCollected(ctx,item.PaymentIntentID,item.CaptainActorID,wltintegration.DerivedExternalReference("cash",item.IdempotencyKey),item.AmountMinor,wltintegration.DerivedIdempotencyKey("collect",item.IdempotencyKey),item.CorrelationID)
		if err!=nil{return fmt.Errorf("collect COD: %w",err)}
		if intent.State!="COLLECTED"{return errors.New("WLT collection did not reach COLLECTED")}
		if _,_,err:=s.wlt.FinalizeCaptainCOD(ctx,item.OrderID,item.PaymentIntentID,item.CaptainActorID,wltintegration.DerivedIdempotencyKey("captain-cod-finalize",item.SourceRef),item.CorrelationID);err!=nil{return fmt.Errorf("finalize captain COD: %w",err)}
		if _,_,err:=s.wlt.FinalizePartnerOrderEarning(ctx,item.OrderID,item.PaymentIntentID,item.PartnerActorID,item.CaptainActorID,wltintegration.DerivedIdempotencyKey("partner-earning",item.OrderID),item.CorrelationID);err!=nil{return fmt.Errorf("finalize partner earning: %w",err)}
		return nil
	case "CAPTAIN_COD_RELEASE":
		if _,_,err:=s.wlt.ReleaseCaptainCOD(ctx,item.OrderID,item.PaymentIntentID,item.CaptainActorID,wltintegration.DerivedIdempotencyKey("captain-cod-release-reassign",item.IdempotencyKey),item.CorrelationID);err!=nil{return fmt.Errorf("release captain COD: %w",err)}
		return nil
	case "PAYMENT_CANCEL":
		prefix:="cancel"
		if item.Reason=="client_cancelled"{prefix="cancel-client"}
		if _,err:=s.wlt.EnsureCancelled(ctx,item.PaymentIntentID,item.Reason,wltintegration.DerivedIdempotencyKey(prefix,item.IdempotencyKey),item.CorrelationID);err!=nil{return fmt.Errorf("cancel payment intent: %w",err)}
		return nil
	default:
		return errors.New("unknown financial handoff effect")
	}
}
