package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type FieldFinanceRosterItem struct {
	ActorID     string
	DisplayName string
	State       string
	CreatedAt   time.Time
}

type FieldFinanceRosterPage struct {
	Items      []FieldFinanceRosterItem
	NextCursor string
	Limit      int
	TotalCount int64
}

type fieldFinanceRosterCursor struct {
	Version     int    `json:"v"`
	Query       string `json:"q"`
	State       string `json:"s"`
	CreatedAt   string `json:"t"`
	AdmissionID string `json:"i"`
}

func ListFieldFinanceRoster(ctx context.Context, db *sql.DB, query, admissionState, rawCursor string, limit int) (FieldFinanceRosterPage, error) {
	query, admissionState = strings.TrimSpace(query), strings.TrimSpace(admissionState)
	if admissionState == "" {
		admissionState = "all"
	}
	if db == nil || len([]rune(query)) > 100 || limit < 1 || limit > 50 || (admissionState != "all" && admissionState != "eligible" && admissionState != "suspended") || len(rawCursor) > 512 {
		return FieldFinanceRosterPage{}, ErrFieldAdmissionRegistry
	}
	cursor, err := decodeFieldFinanceRosterCursor(rawCursor, query, admissionState)
	if err != nil {
		return FieldFinanceRosterPage{}, err
	}
	var total int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM dsh.field_admissions
		WHERE actor_id IS NOT NULL AND actor_id<>'' AND state IN ('eligible','suspended')
		AND ($1='all' OR state=$1)
		AND ($2='' OR full_name_ar ILIKE '%'||$2||'%' OR actor_id ILIKE '%'||$2||'%')`, admissionState, query).Scan(&total); err != nil {
		return FieldFinanceRosterPage{}, err
	}
	var cursorCreatedAt any
	var cursorID string
	if cursor != nil {
		cursorCreatedAt = cursor.CreatedAt
		cursorID = cursor.AdmissionID
	}
	rows, err := db.QueryContext(ctx, `SELECT id,actor_id,COALESCE(full_name_ar,''),state,created_at
		FROM dsh.field_admissions
		WHERE actor_id IS NOT NULL AND actor_id<>'' AND state IN ('eligible','suspended')
		AND ($1='all' OR state=$1)
		AND ($2='' OR full_name_ar ILIKE '%'||$2||'%' OR actor_id ILIKE '%'||$2||'%')
		AND (NOT $3::boolean OR (created_at,id)<($4::timestamptz,$5))
	ORDER BY created_at DESC,id DESC LIMIT $6`, admissionState, query, cursor != nil, cursorCreatedAt, cursorID, limit+1)
	if err != nil {
		return FieldFinanceRosterPage{}, err
	}
	defer rows.Close()
	items := make([]FieldFinanceRosterItem, 0, limit+1)
	admissionIDs := make([]string, 0, limit+1)
	for rows.Next() {
		var item FieldFinanceRosterItem
		var admissionID string
		if err := rows.Scan(&admissionID, &item.ActorID, &item.DisplayName, &item.State, &item.CreatedAt); err != nil {
			return FieldFinanceRosterPage{}, err
		}
		admissionIDs = append(admissionIDs, admissionID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return FieldFinanceRosterPage{}, err
	}
	if err := rows.Close(); err != nil {
		return FieldFinanceRosterPage{}, err
	}
	page := FieldFinanceRosterPage{Items: items, Limit: limit, TotalCount: total}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		lastAdmissionID := admissionIDs[limit-1]
		encoded, _ := json.Marshal(fieldFinanceRosterCursor{Version: 1, Query: query, State: admissionState, CreatedAt: last.CreatedAt.UTC().Format(time.RFC3339Nano), AdmissionID: lastAdmissionID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return page, nil
}

func decodeFieldFinanceRosterCursor(raw, query, state string) (*fieldFinanceRosterCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrFieldAdmissionRegistry
	}
	var cursor fieldFinanceRosterCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.Version != 1 || cursor.Query != query || cursor.State != state || cursor.AdmissionID == "" || cursor.CreatedAt == "" {
		return nil, ErrFieldAdmissionRegistry
	}
	if _, err := time.Parse(time.RFC3339Nano, cursor.CreatedAt); err != nil {
		return nil, ErrFieldAdmissionRegistry
	}
	return &cursor, nil
}
