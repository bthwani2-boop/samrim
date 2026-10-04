package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type FieldAcquisitionEntitlementOutbox struct {
	ID                    string
	JoiningCaseID         string
	StoreID               string
	PartnerActorID        string
	FieldActorID          string
	VerticalID            string
	CommercialStoreTypeID string
	IdempotencyKey        string
	RequestHash           string
	CorrelationID         string
	Attempts              int
}

func enqueueFieldAcquisitionRewardPublicationTx(ctx context.Context, tx *sql.Tx, storeID, correlationID string) error {
	var fieldActorID, verticalID string
	var joiningCaseID, partnerActorID string
	var commercialStoreTypeID string
	err := tx.QueryRowContext(ctx, `SELECT jc.id,jc.originating_field_actor_id,jc.partner_actor_id,s.primary_vertical_id,s.commercial_store_type_id FROM dsh.stores s JOIN dsh.joining_cases jc ON jc.store_id=s.id WHERE s.id=$1 AND jc.origin='field' AND jc.originating_field_actor_id IS NOT NULL AND jc.partner_actor_id IS NOT NULL`, strings.TrimSpace(storeID)).Scan(&joiningCaseID, &fieldActorID, &partnerActorID, &verticalID, &commercialStoreTypeID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read Field acquisition reward publication provenance: %w", err)
	}
	storeID = strings.TrimSpace(storeID)
	joiningCaseID = strings.TrimSpace(joiningCaseID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	fieldActorID = strings.TrimSpace(fieldActorID)
	verticalID = strings.TrimSpace(verticalID)
	commercialStoreTypeID = strings.TrimSpace(commercialStoreTypeID)
	idempotencyKey := "field-acquisition:" + hashFacts("entitlement-idempotency", joiningCaseID)
	requestHash := hashFacts("field-acquisition-customer-visible", joiningCaseID, partnerActorID, fieldActorID, verticalID)
	outboxID, err := newID("field_acquisition")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_acquisition_entitlement_outbox(id,store_id,joining_case_id,partner_actor_id,field_actor_id,vertical_id,commercial_store_type_id,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (store_id) DO NOTHING`, outboxID, storeID, joiningCaseID, partnerActorID, fieldActorID, verticalID, commercialStoreTypeID, idempotencyKey, requestHash, strings.TrimSpace(correlationID))
	return err
}

func ListPendingFieldAcquisitionRewardPublications(ctx context.Context, db *sql.DB, limit int) ([]FieldAcquisitionEntitlementOutbox, error) {
	if db == nil || limit < 1 || limit > 100 {
		return nil, errors.New("Field acquisition reward outbox input is invalid")
	}
	rows, err := db.QueryContext(ctx, `SELECT id,joining_case_id,store_id,partner_actor_id,field_actor_id,vertical_id,COALESCE(commercial_store_type_id,''),idempotency_key,request_hash,correlation_id,attempts FROM dsh.field_acquisition_entitlement_outbox WHERE state NOT IN ('POSTED','WAITING_CLASSIFICATION') AND next_attempt_at <= clock_timestamp() ORDER BY next_attempt_at ASC,created_at ASC,id ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending Field acquisition reward publications: %w", err)
	}
	defer rows.Close()
	items := make([]FieldAcquisitionEntitlementOutbox, 0, limit)
	for rows.Next() {
		var item FieldAcquisitionEntitlementOutbox
		if err := rows.Scan(&item.ID, &item.JoiningCaseID, &item.StoreID, &item.PartnerActorID, &item.FieldActorID, &item.VerticalID, &item.CommercialStoreTypeID, &item.IdempotencyKey, &item.RequestHash, &item.CorrelationID, &item.Attempts); err != nil {
			return nil, fmt.Errorf("scan pending Field acquisition reward publication: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read pending Field acquisition reward publications: %w", err)
	}
	return items, nil
}

func DeferFieldAcquisitionPublication(ctx context.Context, db *sql.DB, outboxID string, policyMissing, classificationMissing bool) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("Field acquisition outbox input is invalid")
	}
	state := "PENDING"
	message := "customer-visible publication is not currently true"
	if policyMissing {
		state = "WAITING_POLICY"
		message = "no active reward policy for the store category"
	}
	if classificationMissing {
		state = "WAITING_CLASSIFICATION"
		message = "the acquired store has no canonical commercial type"
	}
	_, err := db.ExecContext(ctx, `UPDATE dsh.field_acquisition_entitlement_outbox SET state=$2,last_error=$3,next_attempt_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() WHERE id=$1`, strings.TrimSpace(outboxID), state, message)
	return err
}

func MarkFieldAcquisitionRewardPublicationPosted(ctx context.Context, db *sql.DB, outboxID string) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("Field acquisition reward outbox input is invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin Field acquisition reward publication completion: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var fieldActorID, storeID string
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_acquisition_entitlement_outbox
		SET state='POSTED',attempts=attempts+1,last_error=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
		WHERE id=$1 AND state <> 'POSTED'
		RETURNING field_actor_id,store_id`, strings.TrimSpace(outboxID)).Scan(&fieldActorID, &storeID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("Field acquisition reward publication is not pending: %w", err)
		}
		return fmt.Errorf("mark Field acquisition reward publication posted: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_go_live_notifications(actor_id,actor_role,store_id,event_type)
		VALUES($1,'field',$2,'field_acquisition_reward_posted')
		ON CONFLICT (store_id,actor_id,actor_role,event_type) DO NOTHING`, fieldActorID, storeID); err != nil {
		return fmt.Errorf("enqueue Field acquisition reward notification: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit Field acquisition reward publication completion: %w", err)
	}
	return nil
}

func MarkFieldAcquisitionRewardPublicationFailure(ctx context.Context, db *sql.DB, outboxID, message string) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("Field acquisition reward outbox input is invalid")
	}
	_, err := db.ExecContext(ctx, `UPDATE dsh.field_acquisition_entitlement_outbox SET state='FAILED',attempts=attempts+1,last_error=NULLIF($2,''),next_attempt_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1`, strings.TrimSpace(outboxID), strings.TrimSpace(message))
	return err
}
