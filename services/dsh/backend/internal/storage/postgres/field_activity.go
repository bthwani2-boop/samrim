package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/lib/pq"
)

// FieldLatestStore is the newest canonical DSH store created by a joining
// journey attributed to a Field actor.
type FieldLatestStore struct {
	StoreID       string
	StoreName     string
	JoiningCaseID string
	CreatedAt     time.Time
}

type FieldLatestJoiningCase struct {
	ID          string
	DisplayName string
	State       string
	CreatedAt   time.Time
}

type FieldActivitySummary struct {
	FieldActorID      string
	JoiningCaseCount  int
	LatestJoiningCase *FieldLatestJoiningCase
	LatestStore       *FieldLatestStore
}

// ListLatestStoresForFields returns the case count, newest attributed case, and
// newest linked canonical store for each requested Field actor, preserving the
// input order. One batched query avoids per-actor reads.
func ListLatestStoresForFields(ctx context.Context, db *sql.DB, fieldActorIDs []string) ([]FieldActivitySummary, error) {
	if db == nil || len(fieldActorIDs) < 1 || len(fieldActorIDs) > 50 {
		return nil, fmt.Errorf("field activity actor list is invalid")
	}
	for _, actorID := range fieldActorIDs {
		if actorID == "" || len(actorID) > 128 {
			return nil, fmt.Errorf("field activity actor list is invalid")
		}
	}
	rows, err := db.QueryContext(ctx, `
		SELECT requested.actor_id, case_count.joining_case_count,
			latest_case.id, latest_case.display_name, latest_case.state, latest_case.created_at,
			latest_store.store_id, latest_store.store_name, latest_store.joining_case_id, latest_store.created_at
		FROM unnest($1::text[]) WITH ORDINALITY AS requested(actor_id, ordinal)
		JOIN LATERAL (
			SELECT COUNT(*) AS joining_case_count
			FROM dsh.joining_cases c
			WHERE c.originating_field_actor_id=requested.actor_id
		) case_count ON true
		LEFT JOIN LATERAL (
			SELECT c.id, COALESCE(NULLIF(btrim(c.business_name),''),NULLIF(btrim(c.first_store_name),'')) AS display_name, c.state, c.created_at
			FROM dsh.joining_cases c
			WHERE c.originating_field_actor_id=requested.actor_id
			ORDER BY c.created_at DESC,c.id DESC
			LIMIT 1
		) latest_case ON true
		LEFT JOIN LATERAL (
			SELECT s.id AS store_id, s.name AS store_name, c.id AS joining_case_id, s.created_at
			FROM dsh.joining_cases c
			JOIN dsh.stores s ON s.id=c.store_id
			WHERE c.originating_field_actor_id=requested.actor_id
			ORDER BY s.created_at DESC,s.id DESC,c.id DESC
			LIMIT 1
		) latest_store ON true
		ORDER BY requested.ordinal`, pq.Array(fieldActorIDs))
	if err != nil {
		return nil, fmt.Errorf("list latest Field stores: %w", err)
	}
	defer rows.Close()

	items := make([]FieldActivitySummary, 0, len(fieldActorIDs))
	for rows.Next() {
		var item FieldActivitySummary
		var caseID, caseDisplayName, caseState sql.NullString
		var caseCreatedAt, storeCreatedAt sql.NullTime
		var storeID, storeName, joiningCaseID sql.NullString
		if err := rows.Scan(&item.FieldActorID, &item.JoiningCaseCount, &caseID, &caseDisplayName, &caseState, &caseCreatedAt, &storeID, &storeName, &joiningCaseID, &storeCreatedAt); err != nil {
			return nil, fmt.Errorf("scan latest Field store: %w", err)
		}
		if caseID.Valid && caseDisplayName.Valid && caseState.Valid && caseCreatedAt.Valid {
			item.LatestJoiningCase = &FieldLatestJoiningCase{ID: caseID.String, DisplayName: caseDisplayName.String, State: caseState.String, CreatedAt: caseCreatedAt.Time}
		}
		if storeID.Valid && storeName.Valid && joiningCaseID.Valid && storeCreatedAt.Valid {
			item.LatestStore = &FieldLatestStore{StoreID: storeID.String, StoreName: storeName.String, JoiningCaseID: joiningCaseID.String, CreatedAt: storeCreatedAt.Time}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read latest Field stores: %w", err)
	}
	return items, nil
}
