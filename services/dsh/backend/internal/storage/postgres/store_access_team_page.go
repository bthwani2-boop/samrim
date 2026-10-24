package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type StoreAccessTeamCounts struct {
	Total     int `json:"total"`
	Active    int `json:"active"`
	Pending   int `json:"pending"`
	Suspended int `json:"suspended"`
}
type StoreAccessTeamPage struct {
	Items      []StoreAccessGrant    `json:"items"`
	NextCursor string                `json:"nextCursor,omitempty"`
	Counts     StoreAccessTeamCounts `json:"counts"`
}
type storeAccessTeamCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func decodeStoreAccessTeamCursor(token string) (storeAccessTeamCursor, error) {
	if token == "" {
		return storeAccessTeamCursor{At: time.Now().UTC().Add(time.Hour)}, nil
	}
	if len(token) > 512 {
		return storeAccessTeamCursor{}, ErrStoreAccessConflict
	}
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return storeAccessTeamCursor{}, ErrStoreAccessConflict
	}
	var c storeAccessTeamCursor
	if json.Unmarshal(b, &c) != nil || c.At.IsZero() || len(c.ID) == 0 || len(c.ID) > 128 || strings.TrimSpace(c.ID) != c.ID {
		return storeAccessTeamCursor{}, ErrStoreAccessConflict
	}
	return c, nil
}
func ListStoreAccessTeamPage(ctx context.Context, db *sql.DB, ownerID, storeID string, limit int, token string) (StoreAccessTeamPage, error) {
	ownerID, storeID = strings.TrimSpace(ownerID), strings.TrimSpace(storeID)
	if db == nil || ownerID == "" || len(ownerID) > 128 || len(storeID) > 128 || limit < 1 || limit > 50 {
		return StoreAccessTeamPage{}, ErrStoreAccessConflict
	}
	cursor, err := decodeStoreAccessTeamCursor(token)
	if err != nil {
		return StoreAccessTeamPage{}, err
	}
	var counts StoreAccessTeamCounts
	err = db.QueryRowContext(ctx, `SELECT COUNT(*),COUNT(*) FILTER (WHERE g.state='active'),
 COUNT(*) FILTER (WHERE g.state IN ('pending_role_admission','pending_partner_activation') OR (g.state='pending_acceptance' AND g.expires_at>clock_timestamp())),
 COUNT(*) FILTER (WHERE g.state='suspended')
 FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
 WHERE g.owner_partner_actor_id=$1 AND s.partner_actor_id=$1 AND ($2='' OR g.store_id=$2)`, ownerID, storeID).Scan(&counts.Total, &counts.Active, &counts.Pending, &counts.Suspended)
	if err != nil {
		return StoreAccessTeamPage{}, err
	}
	rows, err := db.QueryContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,
 CASE WHEN g.state='pending_acceptance' AND g.expires_at<=clock_timestamp() THEN 'expired' ELSE g.state END,
 g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at,g.display_name_ar
 FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
 WHERE g.owner_partner_actor_id=$1 AND s.partner_actor_id=$1 AND ($2='' OR g.store_id=$2)
 AND (g.created_at,g.id)<($3,$4) ORDER BY g.created_at DESC,g.id DESC LIMIT $5`, ownerID, storeID, cursor.At, cursor.ID, limit+1)
	if err != nil {
		return StoreAccessTeamPage{}, err
	}
	defer rows.Close()
	items, err := scanStoreAccessGrantRows(rows)
	if err != nil {
		return StoreAccessTeamPage{}, err
	}
	if items == nil {
		items = []StoreAccessGrant{}
	}
	page := StoreAccessTeamPage{Items: items, Counts: counts}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		encoded, err := json.Marshal(storeAccessTeamCursor{At: last.CreatedAt.UTC(), ID: last.ID})
		if err != nil {
			return StoreAccessTeamPage{}, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return page, nil
}
