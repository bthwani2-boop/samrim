package postgres

import (
	"context"
	"database/sql"
	"strings"

	"github.com/lib/pq"
)

type PartnerFinancePresentation struct {
	PartnerActorID string
	BusinessName   string
}

func ReadPartnerFinancePresentations(ctx context.Context, db *sql.DB, actorIDs []string) (map[string]PartnerFinancePresentation, error) {
	if db == nil {
		return nil, ErrJoiningCaseInvalid
	}
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
		return map[string]PartnerFinancePresentation{}, nil
	}
	rows, err := db.QueryContext(ctx, `
		SELECT partner_actor_id,COALESCE(business_name,'')
		FROM dsh.joining_cases
		WHERE partner_actor_id = ANY($1)
	`, pq.Array(unique))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]PartnerFinancePresentation, len(unique))
	for rows.Next() {
		var item PartnerFinancePresentation
		if err := rows.Scan(&item.PartnerActorID, &item.BusinessName); err != nil {
			return nil, err
		}
		result[item.PartnerActorID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
