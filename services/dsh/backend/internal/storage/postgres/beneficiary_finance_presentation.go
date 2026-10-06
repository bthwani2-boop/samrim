package postgres

import (
	"context"
	"database/sql"
	"strings"

	"github.com/lib/pq"
)

func ReadBeneficiaryFinanceDisplayNames(ctx context.Context, db *sql.DB, actorType string, actorIDs []string) (map[string]string, error) {
	if db == nil {
		return nil, ErrJoiningCaseInvalid
	}
	actorType = strings.ToLower(strings.TrimSpace(actorType))
	unique := make([]string, 0, len(actorIDs))
	seen := make(map[string]struct{}, len(actorIDs))
	for _, raw := range actorIDs {
		actorID := strings.TrimSpace(raw)
		if actorID == "" || len(actorID) > 128 {
			continue
		}
		if _, exists := seen[actorID]; exists {
			continue
		}
		seen[actorID] = struct{}{}
		unique = append(unique, actorID)
	}
	if len(unique) == 0 {
		return map[string]string{}, nil
	}
	query := ""
	switch actorType {
	case "partner":
		query = "SELECT partner_actor_id,COALESCE(business_name,'') FROM dsh.joining_cases WHERE partner_actor_id = ANY($1)"
	case "field":
		query = "SELECT actor_id,COALESCE(full_name_ar,'') FROM dsh.field_admissions WHERE actor_id = ANY($1)"
	case "captain":
		query = "SELECT actor_id,COALESCE(full_name_ar,'') FROM dsh.captain_admissions WHERE actor_id = ANY($1)"
	default:
		return map[string]string{}, nil
	}
	rows, err := db.QueryContext(ctx, query, pq.Array(unique))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]string, len(unique))
	for rows.Next() {
		var actorID, displayName string
		if err := rows.Scan(&actorID, &displayName); err != nil {
			return nil, err
		}
		result[actorID] = strings.TrimSpace(displayName)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
