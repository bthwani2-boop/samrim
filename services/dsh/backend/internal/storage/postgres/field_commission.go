package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type FieldCommissionPublicationOutbox struct {
	ID             string
	StoreID        string
	FieldActorID   string
	VerticalID     string
	IdempotencyKey string
	RequestHash    string
	CorrelationID  string
	Attempts       int
}

func enqueueFieldCommissionPublicationTx(ctx context.Context, tx *sql.Tx, storeID, correlationID string) error {
	var fieldActorID, verticalID string
	err := tx.QueryRowContext(ctx, `SELECT jc.originating_field_actor_id,s.primary_vertical_id FROM dsh.stores s JOIN dsh.joining_cases jc ON jc.store_id=s.id WHERE s.id=$1 AND jc.origin='field' AND jc.originating_field_actor_id IS NOT NULL`, strings.TrimSpace(storeID)).Scan(&fieldActorID, &verticalID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read Field commission publication provenance: %w", err)
	}
	storeID = strings.TrimSpace(storeID)
	fieldActorID = strings.TrimSpace(fieldActorID)
	verticalID = strings.TrimSpace(verticalID)
	idempotencyKey := "field-commission:" + storeID
	requestHash := hashFacts("field-commission-publication", storeID, fieldActorID, verticalID)
	outboxID, err := newID("field_commission")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_commission_publication_outbox(id,store_id,field_actor_id,vertical_id,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (store_id) DO NOTHING`, outboxID, storeID, fieldActorID, verticalID, idempotencyKey, requestHash, strings.TrimSpace(correlationID))
	return err
}

func ListPendingFieldCommissionPublications(ctx context.Context, db *sql.DB, limit int) ([]FieldCommissionPublicationOutbox, error) {
	if db == nil || limit < 1 || limit > 100 {
		return nil, errors.New("Field commission outbox input is invalid")
	}
	rows, err := db.QueryContext(ctx, `SELECT id,store_id,field_actor_id,vertical_id,idempotency_key,request_hash,correlation_id,attempts FROM dsh.field_commission_publication_outbox WHERE state <> 'POSTED' AND next_attempt_at <= clock_timestamp() ORDER BY next_attempt_at ASC,created_at ASC,id ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending Field commission publications: %w", err)
	}
	defer rows.Close()
	items := make([]FieldCommissionPublicationOutbox, 0, limit)
	for rows.Next() {
		var item FieldCommissionPublicationOutbox
		if err := rows.Scan(&item.ID, &item.StoreID, &item.FieldActorID, &item.VerticalID, &item.IdempotencyKey, &item.RequestHash, &item.CorrelationID, &item.Attempts); err != nil {
			return nil, fmt.Errorf("scan pending Field commission publication: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read pending Field commission publications: %w", err)
	}
	return items, nil
}

func MarkFieldCommissionPublicationPosted(ctx context.Context, db *sql.DB, outboxID string) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("Field commission outbox input is invalid")
	}
	_, err := db.ExecContext(ctx, `UPDATE dsh.field_commission_publication_outbox SET state='POSTED',attempts=attempts+1,last_error=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, strings.TrimSpace(outboxID))
	return err
}

func MarkFieldCommissionPublicationFailure(ctx context.Context, db *sql.DB, outboxID, message string) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("Field commission outbox input is invalid")
	}
	_, err := db.ExecContext(ctx, `UPDATE dsh.field_commission_publication_outbox SET state='FAILED',attempts=attempts+1,last_error=NULLIF($2,''),next_attempt_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1`, strings.TrimSpace(outboxID), strings.TrimSpace(message))
	return err
}
