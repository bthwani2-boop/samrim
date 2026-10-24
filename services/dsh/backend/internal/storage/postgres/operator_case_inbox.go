package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type opsCaseInboxCursor struct {
	Priority string    `json:"priority"`
	OpenedAt time.Time `json:"openedAt"`
	ID       int64     `json:"id"`
}

func encodeCaseInboxCursor(item OpsCase) string {
	data, _ := json.Marshal(opsCaseInboxCursor{Priority: item.Priority, OpenedAt: item.OpenedAt, ID: item.ID})
	return base64.RawURLEncoding.EncodeToString(data)
}
func decodeCaseInboxCursor(raw string) (opsCaseInboxCursor, error) {
	var item opsCaseInboxCursor
	if len(raw) > 512 {
		return item, ErrOpsCaseInvalid
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(data, &item) != nil || !validCasePriority(item.Priority) || item.OpenedAt.IsZero() || item.ID <= 0 {
		return opsCaseInboxCursor{}, ErrOpsCaseInvalid
	}
	return item, nil
}
func ListOpenOpsCases(ctx context.Context, db *sql.DB, actorID, scope string, limit int, cursor string) (OpsCasePage, error) {
	result := OpsCasePage{Items: []OpsCase{}}
	if db == nil || actorID == "" || len(actorID) > 128 || limit < 1 || limit > 30 ||
		(scope != "all" && scope != "mine" && scope != "unassigned") {
		return result, ErrOpsCaseInvalid
	}
	position := opsCaseInboxCursor{Priority: "", OpenedAt: time.Unix(0, 0).UTC(), ID: 0}
	if strings.TrimSpace(cursor) != "" {
		var err error
		position, err = decodeCaseInboxCursor(strings.TrimSpace(cursor))
		if err != nil {
			return result, err
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT `+caseColumns+` FROM dsh.operator_order_cases
 WHERE state<>'RESOLVED'
 AND ($1='all' OR ($1='mine' AND owner_actor_id=$2) OR ($1='unassigned' AND owner_actor_id IS NULL))
 AND ($3='' OR priority<$3 OR (priority=$3 AND (opened_at,id)>($4,$5)))
 ORDER BY priority DESC,opened_at ASC,id ASC LIMIT $6`,
		scope, actorID, position.Priority, position.OpenedAt, position.ID, limit+1)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := readCaseScan(rows)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.NextCursor = encodeCaseInboxCursor(result.Items[limit-1])
	}
	return result, nil
}
