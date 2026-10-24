package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrClientShareInvalid = errors.New("client share invalid")
var ErrClientShareRateLimited = errors.New("client share rate limit")
var ErrClientShareConflict = errors.New("client share idempotency conflict")
var ErrClientShareNotFound = errors.New("client share not found")

type ClientShare struct {
	ID            int64      `json:"id"`
	SenderActorID string     `json:"senderActorId"`
	ContentKind   string     `json:"contentKind"`
	ContentID     string     `json:"contentId"`
	ContentTitle  string     `json:"contentTitle"`
	StoreID       string     `json:"storeId"`
	ProductID     string     `json:"productId"`
	MessageCode   string     `json:"messageCode"`
	CreatedAt     time.Time  `json:"createdAt"`
	ReadAt        *time.Time `json:"readAt"`
}

type ClientSharePage struct {
	Items       []ClientShare `json:"items"`
	UnreadCount int           `json:"unreadCount"`
	NextBefore  int64         `json:"nextBefore"`
}

func clientShareHash(kind, id, messageCode, recipientPhone string) string {
	sum := sha256.Sum256([]byte(kind + "\x00" + id + "\x00" + messageCode + "\x00" + recipientPhone))
	return hex.EncodeToString(sum[:])
}

func ClientShareExists(ctx context.Context, db *sql.DB, kind, resourceID string) (bool, error) {
	var q string
	switch kind {
	case "STORE":
		q = `SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND publication_state='published' AND deleted_at IS NULL)`
	case "OFFER":
		q = `SELECT EXISTS(SELECT 1 FROM dsh.catalog_store_offers o JOIN dsh.stores s ON s.id=o.store_id WHERE o.id=$1 AND o.publication_state='published' AND o.availability=true AND s.publication_state='published' AND s.deleted_at IS NULL)`
	case "PROMOTION":
		q = `SELECT EXISTS(SELECT 1 FROM dsh.commerce_promotions p WHERE p.id=$1 AND p.state='PUBLISHED' AND p.starts_at<=clock_timestamp() AND (p.ends_at IS NULL OR p.ends_at>clock_timestamp()) AND NOT EXISTS (SELECT 1 FROM dsh.marketing_campaign_promotion_links l JOIN dsh.marketing_campaigns c ON c.id=l.campaign_id WHERE l.promotion_id=p.id AND c.state<>'PUBLISHED'))`
	case "CONTENT":
		q = `SELECT EXISTS(SELECT 1 FROM dsh.discovery_content c WHERE c.id=$1 AND c.state='PUBLISHED' AND c.starts_at<=clock_timestamp() AND (c.ends_at IS NULL OR c.ends_at>clock_timestamp()) AND NOT EXISTS (SELECT 1 FROM dsh.marketing_campaign_content_links l JOIN dsh.marketing_campaigns campaign ON campaign.id=l.campaign_id WHERE l.content_id=c.id AND campaign.state<>'PUBLISHED'))`
	default:
		return false, ErrClientShareInvalid
	}
	var exists bool
	err := db.QueryRowContext(ctx, q, resourceID).Scan(&exists)
	return exists, err
}

// SendClientShare is sender-serialized and idempotent. The actor ID, content
// existence and rate limits are server-enforced; the UI never writes share rows.
func SendClientShare(ctx context.Context, db *sql.DB, senderID, recipientID, recipientPhone, kind, contentID, messageCode, idem string) error {
	if db == nil || strings.TrimSpace(senderID) == "" || strings.TrimSpace(recipientID) == "" || senderID == recipientID || len(idem) < 8 || len(idem) > 128 || strings.TrimSpace(contentID) == "" || len(contentID) > 128 {
		return ErrClientShareInvalid
	}
	hash := clientShareHash(kind, contentID, messageCode, recipientPhone)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, senderID); err != nil {
		return err
	}
	var priorHash string
	err = tx.QueryRowContext(ctx, `SELECT request_hash FROM dsh.client_content_shares WHERE sender_actor_id=$1 AND idempotency_key=$2`, senderID, idem).Scan(&priorHash)
	if err == nil {
		if priorHash != hash {
			return ErrClientShareConflict
		}
		return tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var tooMany bool
	err = tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM dsh.client_content_shares WHERE sender_actor_id=$1 AND created_at>clock_timestamp()-interval '1 hour') >= 20 OR (SELECT count(*) FROM dsh.client_content_shares WHERE sender_actor_id=$1 AND recipient_actor_id=$2 AND created_at>clock_timestamp()-interval '1 hour') >= 5`, senderID, recipientID).Scan(&tooMany)
	if err != nil {
		return err
	}
	if tooMany {
		return ErrClientShareRateLimited
	}
	var blocked bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.client_share_blocks WHERE recipient_actor_id=$1 AND sender_actor_id=$2)`, recipientID, senderID).Scan(&blocked); err != nil {
		return err
	}
	if blocked {
		return tx.Commit()
	} // deliberately indistinguishable from accepted send
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.client_content_shares(sender_actor_id,recipient_actor_id,content_kind,content_id,message_code,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, senderID, recipientID, kind, contentID, messageCode, idem, hash); err != nil {
		return fmt.Errorf("save client share: %w", err)
	}
	return tx.Commit()
}

func ListClientShares(ctx context.Context, db *sql.DB, actorID string, before int64, limit int) (ClientSharePage, error) {
	if db == nil || actorID == "" || before < 0 || limit < 1 || limit > 50 {
		return ClientSharePage{}, ErrClientShareInvalid
	}
	rows, err := db.QueryContext(ctx, `SELECT share.id,share.sender_actor_id,share.content_kind,share.content_id,
      COALESCE(store.name,product.canonical_name,promotion.name_ar,content.title_ar,''),
      COALESCE(offer.store_id,promotion.store_id,CASE WHEN share.content_kind='STORE' THEN share.content_id END,''),
      COALESCE(variant.product_id,''),share.message_code,share.created_at,share.read_at
      FROM dsh.client_content_shares share
      LEFT JOIN dsh.stores store ON share.content_kind='STORE' AND store.id=share.content_id
      LEFT JOIN dsh.catalog_store_offers offer ON share.content_kind='OFFER' AND offer.id=share.content_id
      LEFT JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
      LEFT JOIN dsh.catalog_products product ON product.id=variant.product_id
      LEFT JOIN dsh.commerce_promotions promotion ON share.content_kind='PROMOTION' AND promotion.id=share.content_id
      LEFT JOIN dsh.discovery_content content ON share.content_kind='CONTENT' AND content.id=share.content_id
      WHERE share.recipient_actor_id=$1 AND ($2::bigint=0 OR share.id<$2)
      ORDER BY share.id DESC LIMIT $3`, actorID, before, limit+1)
	if err != nil {
		return ClientSharePage{}, err
	}
	defer rows.Close()
	page := ClientSharePage{Items: []ClientShare{}}
	for rows.Next() {
		var item ClientShare
		var readAt sql.NullTime
		if err = rows.Scan(&item.ID, &item.SenderActorID, &item.ContentKind, &item.ContentID, &item.ContentTitle, &item.StoreID, &item.ProductID, &item.MessageCode, &item.CreatedAt, &readAt); err != nil {
			return ClientSharePage{}, err
		}
		if readAt.Valid {
			item.ReadAt = &readAt.Time
		}
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return ClientSharePage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextBefore = page.Items[len(page.Items)-1].ID
	}
	err = db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.client_content_shares WHERE recipient_actor_id=$1 AND read_at IS NULL`, actorID).Scan(&page.UnreadCount)
	return page, err
}

func MarkClientShareRead(ctx context.Context, db *sql.DB, actorID string, shareID int64) error {
	if actorID == "" || shareID < 1 {
		return ErrClientShareInvalid
	}
	result, err := db.ExecContext(ctx, `UPDATE dsh.client_content_shares SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=$1 AND recipient_actor_id=$2`, shareID, actorID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrClientShareNotFound
	}
	return nil
}

func BlockClientShareSender(ctx context.Context, db *sql.DB, recipientID, senderID string, blocked bool) error {
	if recipientID == "" || senderID == "" || recipientID == senderID || len(senderID) > 128 {
		return ErrClientShareInvalid
	}
	if blocked {
		// Only actors who previously shared with this recipient can be blocked here.
		_, err := db.ExecContext(ctx, `INSERT INTO dsh.client_share_blocks(recipient_actor_id,sender_actor_id) SELECT $1,$2 WHERE EXISTS (SELECT 1 FROM dsh.client_content_shares WHERE recipient_actor_id=$1 AND sender_actor_id=$2) ON CONFLICT DO NOTHING`, recipientID, senderID)
		return err
	}
	_, err := db.ExecContext(ctx, `DELETE FROM dsh.client_share_blocks WHERE recipient_actor_id=$1 AND sender_actor_id=$2`, recipientID, senderID)
	return err
}
