package challenge

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	challengedelivery "github.com/bthwani2-boop/samrim/services/identity/backend/internal/integrations/challenge"
)

type pendingDelivery struct {
	challengeID string
	actorID string
	phone string
	role string
	purpose string
	expiresAt time.Time
}

func (s *Service) RunDeliveryWorker(ctx context.Context) error {
	if _,err:=s.db.ExecContext(ctx,"UPDATE identity_challenge_deliveries SET status='unknown',finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE status='sending'");err!=nil{
		return fmt.Errorf("recover challenge delivery state: %w",err)
	}
	ticker:=time.NewTicker(250*time.Millisecond);defer ticker.Stop()
	for{
		worked,err:=s.deliverNext(ctx)
		if err!=nil{if ctx.Err()!=nil{return nil};return err}
		if worked{continue}
		select{case<-ctx.Done():return nil;case<-ticker.C:}
	}
}

func (s *Service) deliverNext(ctx context.Context)(bool,error){
	tx,err:=s.db.BeginTx(ctx,nil);if err!=nil{return false,err};defer func(){_ = tx.Rollback()}()
	if _,err:=tx.ExecContext(ctx,"UPDATE identity_challenge_deliveries d SET status='expired',finished_at=clock_timestamp(),updated_at=clock_timestamp() FROM identity_challenges c WHERE d.challenge_id=c.id AND d.status='pending' AND c.expires_at<=clock_timestamp()");err!=nil{return false,err}
	if _,err:=tx.ExecContext(ctx,"UPDATE identity_challenge_deliveries d SET status='suppressed',finished_at=clock_timestamp(),updated_at=clock_timestamp() FROM identity_challenges c WHERE d.challenge_id=c.id AND d.status='pending' AND c.status<>'pending'");err!=nil{return false,err}
	var item pendingDelivery;var actorID sql.NullString
	err=tx.QueryRowContext(ctx,"SELECT c.id,c.actor_id,c.phone_e164,c.role,c.purpose,c.expires_at FROM identity_challenge_deliveries d JOIN identity_challenges c ON c.id=d.challenge_id WHERE d.status='pending' AND c.status='pending' AND c.expires_at>clock_timestamp() ORDER BY d.created_at,c.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED").
		Scan(&item.challengeID,&actorID,&item.phone,&item.role,&item.purpose,&item.expiresAt)
	if errors.Is(err,sql.ErrNoRows){if err:=tx.Commit();err!=nil{return false,err};return false,nil}
	if err!=nil{return false,err};if actorID.Valid{item.actorID=actorID.String}
	if _,err:=tx.ExecContext(ctx,"UPDATE identity_challenge_deliveries SET status='sending',attempts=1,started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE challenge_id=$1 AND status='pending'",item.challengeID);err!=nil{return false,err}
	if err:=tx.Commit();err!=nil{return false,err}
	code,err:=s.codeFor(item.challengeID,item.purpose);if err!=nil{return true,s.finishDelivery(ctx,item,"unknown")}
	surface,ok:=domain.SurfaceForRole(item.role);if !ok{return true,s.finishDelivery(ctx,item,"unknown")}
	status:="sent"
	if err:=s.sender.Send(ctx,challengedelivery.Message{Phone:item.phone,Code:code,Role:item.role,Purpose:item.purpose,Surface:surface,ExpiresAt:item.expiresAt});err!=nil{status="unknown"}
	if err:=s.finishDelivery(ctx,item,status);err!=nil{return true,err}
	return true,nil
}

func (s *Service) finishDelivery(ctx context.Context,item pendingDelivery,status string)error{
	tx,err:=s.db.BeginTx(ctx,nil);if err!=nil{return err};defer func(){_ = tx.Rollback()}()
	if _,err:=tx.ExecContext(ctx,"UPDATE identity_challenge_deliveries SET status=$1,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE challenge_id=$2 AND status='sending'",status,item.challengeID);err!=nil{return err}
	outcome:="success";if status!="sent"{outcome="unknown"}
	if err:=auditTx(ctx,tx,"challenge.delivery_"+status,item.actorID,"challenge-delivery",outcome,"",map[string]any{"role":item.role,"purpose":item.purpose,"provider":s.sender.Provider()});err!=nil{return err}
	return tx.Commit()
}
