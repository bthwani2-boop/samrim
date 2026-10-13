package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

// StoreAccessRoleAdmissionPage is the bounded, keyset-ordered read for operator admission.
// Its cursor is opaque to callers, and does not embed a delegate's contact details.
type StoreAccessRoleAdmissionPage struct {
	Items      []StoreAccessGrant `json:"items"`
	NextCursor string             `json:"nextCursor"`
}

type storeAccessRoleAdmissionCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func decodeStoreAccessRoleAdmissionCursor(token string) (storeAccessRoleAdmissionCursor, error) {
	if token == "" {
		return storeAccessRoleAdmissionCursor{At: time.Unix(0, 0).UTC()}, nil
	}
	if len(token) > 512 {
		return storeAccessRoleAdmissionCursor{}, ErrStoreAccessConflict
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return storeAccessRoleAdmissionCursor{}, ErrStoreAccessConflict
	}
	var c storeAccessRoleAdmissionCursor
	if err := json.Unmarshal(raw, &c); err != nil || c.At.IsZero() || len(c.ID) < 1 || len(c.ID) > 128 || strings.TrimSpace(c.ID) != c.ID {
		return storeAccessRoleAdmissionCursor{}, ErrStoreAccessConflict
	}
	return c, nil
}

func ListPendingStoreAccessRoleAdmissionsPage(ctx context.Context, db *sql.DB, limit int, token string) (StoreAccessRoleAdmissionPage, error) {
	if db == nil || limit < 1 || limit > 50 {
		return StoreAccessRoleAdmissionPage{}, ErrStoreAccessConflict
	}
	cursor, err := decodeStoreAccessRoleAdmissionCursor(token)
	if err != nil {
		return StoreAccessRoleAdmissionPage{}, err
	}
	rows, err := db.QueryContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,g.state,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
		WHERE g.state='pending_role_admission' AND g.accepted_at IS NOT NULL
		  AND (g.created_at,g.id) > ($1,$2)
		ORDER BY g.created_at,g.id
		LIMIT $3`, cursor.At, cursor.ID, limit+1)
	if err != nil {
		return StoreAccessRoleAdmissionPage{}, err
	}
	defer rows.Close()
	items, err := scanStoreAccessGrantRows(rows)
	if err != nil {
		return StoreAccessRoleAdmissionPage{}, err
	}
	if items == nil {
		items = []StoreAccessGrant{}
	}
	page := StoreAccessRoleAdmissionPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		encoded, err := json.Marshal(storeAccessRoleAdmissionCursor{At: last.CreatedAt.UTC(), ID: last.ID})
		if err != nil {
			return StoreAccessRoleAdmissionPage{}, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return page, nil
}
