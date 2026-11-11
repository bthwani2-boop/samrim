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

// A share receipt outlives the publication of its target. Resolve current
// eligibility and display fields together when delivering or reading a share.
const clientSharePublishedTargetSQL = `
		WITH marketplace_stores AS NOT MATERIALIZED (
			SELECT id,name FROM dsh.stores
			WHERE relation_model='BTHWANI_PARTNER' AND publication_state='published' AND deleted_at IS NULL
		)
		SELECT store.name AS title,store.id AS store_id,''::text AS product_id
		FROM marketplace_stores store
		WHERE resource.kind='STORE' AND store.id=resource.id
		UNION ALL
		SELECT product.canonical_name,offer.store_id,product.id
		FROM dsh.catalog_store_offers offer
		JOIN dsh.catalog_customer_visible_offers visible ON visible.offer_id=offer.id
		JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
		JOIN dsh.catalog_products product ON product.id=variant.product_id
		JOIN marketplace_stores store ON store.id=offer.store_id
		WHERE resource.kind='OFFER' AND offer.id=resource.id
		UNION ALL
		SELECT p.name_ar,p.store_id,''
		FROM dsh.commerce_promotions p
		WHERE resource.kind='PROMOTION' AND p.id=resource.id AND p.state='PUBLISHED'
			  AND p.starts_at<=statement_timestamp()
			  AND (p.ends_at IS NULL OR p.ends_at>statement_timestamp())
			  AND NOT EXISTS (
			    SELECT 1 FROM dsh.marketing_campaign_promotion_links link
			    JOIN dsh.marketing_campaigns campaign ON campaign.id=link.campaign_id
			    WHERE link.promotion_id=p.id AND campaign.state<>'PUBLISHED'
			  )
			  AND (NULLIF(p.store_id,'') IS NULL OR EXISTS (
			    SELECT 1 FROM marketplace_stores store WHERE store.id=p.store_id
			  ))
		UNION ALL
		SELECT c.title_ar,'',''
		FROM dsh.discovery_content c
		WHERE resource.kind='CONTENT' AND c.id=resource.id AND c.state='PUBLISHED'
			  AND c.starts_at<=statement_timestamp()
			  AND (c.ends_at IS NULL OR c.ends_at>statement_timestamp())
			  AND NOT EXISTS (
			    SELECT 1 FROM dsh.marketing_campaign_content_links link
			    JOIN dsh.marketing_campaigns campaign ON campaign.id=link.campaign_id
			    WHERE link.content_id=c.id AND campaign.state<>'PUBLISHED'
			  )
			  AND (NULLIF(c.source_store_id,'') IS NULL OR EXISTS (
			    SELECT 1 FROM marketplace_stores source_store
			    WHERE source_store.id=c.source_store_id
			  ))
			  AND (c.target_type<>'STORE' OR EXISTS (
			    SELECT 1 FROM marketplace_stores target_store WHERE target_store.id=c.target_id
			      AND (c.source_store_id IS NULL OR target_store.id=c.source_store_id)
			  ))
			  AND (c.target_type<>'PROMOTION' OR EXISTS (
			    SELECT 1 FROM dsh.commerce_promotions promotion
			    WHERE promotion.id=c.target_id AND promotion.state='PUBLISHED'
			      AND (c.source_store_id IS NULL OR promotion.store_id=c.source_store_id)
			      AND (NULLIF(promotion.store_id,'') IS NULL OR EXISTS (
			        SELECT 1 FROM marketplace_stores target_store WHERE target_store.id=promotion.store_id
			      ))
			  ))
			  AND (c.target_type<>'PRODUCT' OR EXISTS (
			    SELECT 1 FROM dsh.catalog_product_variants variant
			    JOIN dsh.catalog_store_offers offer ON offer.variant_id=variant.id
			    JOIN marketplace_stores store ON store.id=offer.store_id
			    JOIN dsh.catalog_customer_visible_offers visible ON visible.offer_id=offer.id
			    WHERE variant.product_id=c.target_id
			      AND (c.source_store_id IS NULL OR store.id=c.source_store_id)
			  ))
			  AND (c.target_type<>'CATEGORY' OR EXISTS (
			    SELECT 1 FROM dsh.catalog_product_categories category
			    JOIN dsh.catalog_product_variants variant ON variant.product_id=category.product_id
			    JOIN dsh.catalog_store_offers offer ON offer.variant_id=variant.id
			    JOIN marketplace_stores store ON store.id=offer.store_id
			    JOIN dsh.catalog_customer_visible_offers visible ON visible.offer_id=offer.id
			    WHERE category.category_id=c.target_id
			      AND (c.source_store_id IS NULL OR store.id=c.source_store_id)
			  ))
		`

const saveClientShareSQL = `
		WITH eligible AS (
			SELECT resource.kind,resource.id
			FROM (VALUES ($3::text,$4::text)) AS resource(kind,id)
			WHERE EXISTS (` + clientSharePublishedTargetSQL + `)
		), delivered AS (
			INSERT INTO dsh.client_content_shares(sender_actor_id,recipient_actor_id,content_kind,content_id,message_code,idempotency_key,request_hash)
			SELECT $1,$2,kind,id,$5,$6,$7 FROM eligible WHERE $8::boolean
			RETURNING id
		)
		SELECT EXISTS(SELECT 1 FROM eligible), EXISTS(SELECT 1 FROM delivered)`

// SendClientShare is sender-serialized and idempotent. The actor ID, content
// existence and rate limits are server-enforced; the UI never writes share rows.
func SendClientShare(ctx context.Context, db *sql.DB, senderID, recipientID, recipientPhone, kind, contentID, messageCode, idem string) error {
	if db == nil || strings.TrimSpace(senderID) == "" || len(idem) < 8 || len(idem) > 128 || strings.TrimSpace(contentID) == "" || len(contentID) > 128 {
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
	knownRecipient := strings.TrimSpace(recipientID) != "" && senderID != recipientID
	var tooMany, blocked bool
	if knownRecipient {
		err = tx.QueryRowContext(ctx, `SELECT
			(SELECT count(*) FROM dsh.client_content_shares WHERE sender_actor_id=$1 AND created_at>clock_timestamp()-interval '1 hour') >= 20
			OR (SELECT count(*) FROM dsh.client_content_shares WHERE sender_actor_id=$1 AND recipient_actor_id=$2 AND created_at>clock_timestamp()-interval '1 hour') >= 5,
			EXISTS(SELECT 1 FROM dsh.client_share_blocks WHERE recipient_actor_id=$2 AND sender_actor_id=$1)`,
			senderID, recipientID).Scan(&tooMany, &blocked)
		if err != nil {
			return err
		}
	}
	// A missing, self or blocked recipient receives no row. The caller still
	// observes the same target eligibility and generic success response.
	deliver := knownRecipient && !blocked && !tooMany
	var eligible, delivered bool
	if err = tx.QueryRowContext(ctx, saveClientShareSQL, senderID, recipientID, kind, contentID, messageCode, idem, hash, deliver).Scan(&eligible, &delivered); err != nil {
		return fmt.Errorf("save client share: %w", err)
	}
	if !eligible {
		return ErrClientShareInvalid
	}
	if tooMany {
		return ErrClientShareRateLimited
	}
	if delivered != deliver {
		return errors.New("client share delivery did not match the eligible attempt")
	}
	return tx.Commit()
}

const listClientSharesSQL = `
		SELECT resource.share_id,resource.sender_actor_id,resource.kind,resource.id,
		       COALESCE(target.title,''),COALESCE(target.store_id,''),COALESCE(target.product_id,''),
		       resource.message_code,resource.created_at,resource.read_at
		FROM (
			SELECT share.id AS share_id,share.sender_actor_id,share.content_kind AS kind,share.content_id AS id,
			       share.message_code,share.created_at,share.read_at
			FROM dsh.client_content_shares share
			WHERE share.recipient_actor_id=$1 AND ($2::bigint=0 OR share.id<$2)
			ORDER BY share.id DESC LIMIT $3
		) resource
		LEFT JOIN LATERAL (` + clientSharePublishedTargetSQL + `) target ON true
		ORDER BY resource.share_id DESC`

func ListClientShares(ctx context.Context, db *sql.DB, actorID string, before int64, limit int) (ClientSharePage, error) {
	if db == nil || actorID == "" || before < 0 || limit < 1 || limit > 50 {
		return ClientSharePage{}, ErrClientShareInvalid
	}
	rows, err := db.QueryContext(ctx, listClientSharesSQL, actorID, before, limit+1)
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
