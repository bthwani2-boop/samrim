package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type dueReceipt struct {
	id            int64
	ticket, token string
	sentAt        time.Time
}

// Expo tickets alone are not delivery proof. Check FCM handoff receipts
// around 15 minutes after the ticket was issued (Expo clears them after 24h).
func (s *Service) checkPushReceipts(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `WITH due AS (
        SELECT id FROM dsh.notification_push_outbox
        WHERE state='sent' AND ticket_id IS NOT NULL AND receipt_checked_at IS NULL
          AND next_receipt_at<=clock_timestamp()
        ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE dsh.notification_push_outbox o SET next_receipt_at=clock_timestamp()+interval '2 minutes'
        FROM due WHERE o.id=due.id RETURNING o.id,o.ticket_id,o.installation_id,o.sent_at
    )
    SELECT c.id,c.ticket_id,COALESCE(d.expo_push_token,''),c.sent_at
    FROM claimed c LEFT JOIN dsh.notification_push_devices d ON d.installation_id=c.installation_id`)
	if err != nil {
		return err
	}
	batch := []dueReceipt{}
	for rows.Next() {
		var row dueReceipt
		if err = rows.Scan(&row.id, &row.ticket, &row.token, &row.sentAt); err != nil {
			break
		}
		batch = append(batch, row)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil || len(batch) == 0 {
		return err
	}
	ids := make([]string, 0, len(batch))
	for _, row := range batch {
		ids = append(ids, row.ticket)
	}
	data, _ := json.Marshal(map[string]any{"ids": ids})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoReceiptEndpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 128*1024))
	res.Body.Close()
	if err != nil {
		return err
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("expo receipts HTTP %d", res.StatusCode)
	}
	var response struct {
		Data map[string]struct {
			Status  string `json:"status"`
			Details struct {
				Error string `json:"error"`
			} `json:"details"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Data == nil {
		return errors.New("invalid Expo receipt response")
	}
	for _, row := range batch {
		receipt, found := response.Data[row.ticket]
		if !found {
			if time.Since(row.sentAt) < 24*time.Hour {
				continue
			}
			_, err = s.db.ExecContext(ctx, `UPDATE dsh.notification_push_outbox
                SET receipt_checked_at=clock_timestamp(),receipt_status='missing'
                WHERE id=$1`, row.id)
			if err != nil {
				return err
			}
			continue
		}
		if receipt.Status != "ok" && receipt.Status != "error" {
			continue
		}
		if receipt.Details.Error == "DeviceNotRegistered" && row.token != "" {
			if err = s.disablePushToken(ctx, row.token); err != nil {
				return err
			}
		}
		_, err = s.db.ExecContext(ctx, `UPDATE dsh.notification_push_outbox
            SET receipt_checked_at=clock_timestamp(),receipt_status=$2,
                state=CASE WHEN $2='error' THEN 'failed' ELSE state END
            WHERE id=$1`, row.id, receipt.Status)
		if err != nil {
			return err
		}
	}
	return nil
}
