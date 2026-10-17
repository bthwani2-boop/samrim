package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrShoppingShortcutInvalid  = errors.New("shopping shortcut facts or targets are invalid")
	ErrShoppingShortcutNotFound = errors.New("shopping shortcut not found")
)

type ShoppingShortcutRecord struct {
	ID           string    `json:"id"`
	VerticalID   string    `json:"verticalId"`
	TitleAr      string    `json:"titleAr"`
	Ordinal      int       `json:"ordinal"`
	Active       bool      `json:"active"`
	Version      int       `json:"version"`
	StoreTypeIDs []string  `json:"storeTypeIds"`
	CategoryIDs  []string  `json:"categoryIds"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ShoppingShortcutInput struct {
	ID              string
	VerticalID      string
	TitleAr         string
	Ordinal         int
	Active          bool
	ExpectedVersion int
	StoreTypeIDs    []string
	CategoryIDs     []string
}

type ShoppingShortcutResult struct {
	Shortcut ShoppingShortcutRecord `json:"shortcut"`
	Replayed bool                   `json:"idempotentReplay"`
}

func HashShoppingShortcutMutation(input ShoppingShortcutInput, reason string) string {
	return hashFacts("shopping-shortcut", input.ID, input.VerticalID, input.TitleAr,
		strconv.Itoa(input.Ordinal), strconv.FormatBool(input.Active), strconv.Itoa(input.ExpectedVersion),
		strings.Join(input.StoreTypeIDs, ","), strings.Join(input.CategoryIDs, ","), reason)
}

const shoppingShortcutSelect = `SELECT sh.id,sh.vertical_id,sh.title_ar,sh.ordinal,sh.active,sh.version,sh.created_at,sh.updated_at,
    ARRAY(SELECT target.store_type_id FROM dsh.catalog_shopping_shortcut_targets target
      WHERE target.shortcut_id=sh.id AND target.store_type_id IS NOT NULL ORDER BY target.store_type_id),
    ARRAY(SELECT target.category_id FROM dsh.catalog_shopping_shortcut_targets target
      WHERE target.shortcut_id=sh.id AND target.category_id IS NOT NULL ORDER BY target.category_id)
    FROM dsh.catalog_shopping_shortcuts sh`

func scanShoppingShortcut(row interface{ Scan(...any) error }) (ShoppingShortcutRecord, error) {
	var record ShoppingShortcutRecord
	err := row.Scan(&record.ID, &record.VerticalID, &record.TitleAr, &record.Ordinal, &record.Active,
		&record.Version, &record.CreatedAt, &record.UpdatedAt,
		pq.Array(&record.StoreTypeIDs), pq.Array(&record.CategoryIDs))
	if errors.Is(err, sql.ErrNoRows) {
		return ShoppingShortcutRecord{}, ErrShoppingShortcutNotFound
	}
	return record, err
}

func ListShoppingShortcuts(ctx context.Context, db *sql.DB, verticalID string, activeOnly bool) ([]ShoppingShortcutRecord, error) {
	rows, err := db.QueryContext(ctx, shoppingShortcutSelect+`
       JOIN dsh.commerce_verticals cv ON cv.id=sh.vertical_id
       WHERE sh.vertical_id=$1 AND ($2=false OR (sh.active=true AND cv.active=true))
       ORDER BY sh.ordinal,lower(sh.title_ar),sh.id`, verticalID, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ShoppingShortcutRecord, 0)
	for rows.Next() {
		item, err := scanShoppingShortcut(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ReadShoppingShortcut(ctx context.Context, db *sql.DB, id string) (ShoppingShortcutRecord, error) {
	return scanShoppingShortcut(db.QueryRowContext(ctx, shoppingShortcutSelect+" WHERE sh.id=$1", id))
}

func readShoppingShortcutTx(ctx context.Context, tx *sql.Tx, id string) (ShoppingShortcutRecord, error) {
	return scanShoppingShortcut(tx.QueryRowContext(ctx, shoppingShortcutSelect+" WHERE sh.id=$1", id))
}

func normalizeShortcutTargetIDs(ids []string) ([]string, bool) {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, raw := range ids {
		id := strings.ToLower(strings.TrimSpace(raw))
		if len(id) < 2 || len(id) > 128 || seen[id] {
			return nil, false
		}
		for _, r := range id {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
				return nil, false
			}
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, true
}

func validateShortcutTargets(ctx context.Context, tx *sql.Tx, input ShoppingShortcutInput) error {
	if len(input.StoreTypeIDs)+len(input.CategoryIDs) == 0 || len(input.StoreTypeIDs)+len(input.CategoryIDs) > 25 {
		return ErrShoppingShortcutInvalid
	}
	types, ok := normalizeShortcutTargetIDs(input.StoreTypeIDs)
	if !ok {
		return ErrShoppingShortcutInvalid
	}
	categories, ok := normalizeShortcutTargetIDs(input.CategoryIDs)
	if !ok {
		return ErrShoppingShortcutInvalid
	}
	input.StoreTypeIDs, input.CategoryIDs = types, categories
	var count int
	if len(types) > 0 {
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM dsh.commercial_store_types
            WHERE vertical_id=$1 AND active=true AND id=ANY($2)`, input.VerticalID, pq.Array(types)).Scan(&count); err != nil {
			return err
		}
		if count != len(types) {
			return ErrShoppingShortcutInvalid
		}
	}
	if len(categories) > 0 {
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM dsh.catalog_categories
            WHERE vertical_id=$1 AND active=true AND deleted_at IS NULL AND id=ANY($2)`, input.VerticalID, pq.Array(categories)).Scan(&count); err != nil {
			return err
		}
		if count != len(categories) {
			return ErrShoppingShortcutInvalid
		}
	}
	return nil
}

// MutateShoppingShortcut is the only writer. Relation checks, audit,
// version and idempotency commit together; no parallel shortcut truth.
func MutateShoppingShortcut(ctx context.Context, db *sql.DB, input ShoppingShortcutInput,
	key, requestHash string, audit CatalogRegistryAuditInput) (ShoppingShortcutResult, error) {
	if db == nil || len(key) < 8 || len(key) > 128 || input.Ordinal < 0 || input.Ordinal > 9999 ||
		len(input.TitleAr) < 2 || len(input.TitleAr) > 160 || input.VerticalID == "" || input.ExpectedVersion < 0 ||
		len(audit.Reason) < 5 || audit.ActingActorID == "" || audit.CorrelationID == "" {
		return ShoppingShortcutResult{}, ErrShoppingShortcutInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ShoppingShortcutResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+key); err != nil {
		return ShoppingShortcutResult{}, err
	}
	var kind, priorID, priorHash string
	err = tx.QueryRowContext(ctx, `SELECT entity_type,entity_id,request_hash
         FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, key).
		Scan(&kind, &priorID, &priorHash)
	if err == nil {
		if kind != "shopping_shortcut" || priorHash != requestHash || input.ID != "" && priorID != input.ID {
			return ShoppingShortcutResult{}, ErrCatalogIdempotencyConflict
		}
		result, err := readShoppingShortcutTx(ctx, tx, priorID)
		if err != nil {
			return ShoppingShortcutResult{}, err
		}
		return ShoppingShortcutResult{Shortcut: result, Replayed: true}, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ShoppingShortcutResult{}, err
	}
	var verticalActive bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1", input.VerticalID).Scan(&verticalActive); err != nil || !verticalActive {
		return ShoppingShortcutResult{}, ErrShoppingShortcutInvalid
	}
	var ok bool
	input.StoreTypeIDs, ok = normalizeShortcutTargetIDs(input.StoreTypeIDs)
	if !ok {
		return ShoppingShortcutResult{}, ErrShoppingShortcutInvalid
	}
	input.CategoryIDs, ok = normalizeShortcutTargetIDs(input.CategoryIDs)
	if !ok {
		return ShoppingShortcutResult{}, ErrShoppingShortcutInvalid
	}
	if err = validateShortcutTargets(ctx, tx, input); err != nil {
		return ShoppingShortcutResult{}, err
	}
	var before ShoppingShortcutRecord
	if input.ExpectedVersion == 0 {
		if input.ID == "" {
			input.ID, err = newID("shopping_shortcut")
			if err != nil {
				return ShoppingShortcutResult{}, err
			}
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_shopping_shortcuts(id,vertical_id,title_ar,ordinal,active)
            VALUES($1,$2,$3,$4,$5)`, input.ID, input.VerticalID, input.TitleAr, input.Ordinal, input.Active)
		if err != nil {
			return ShoppingShortcutResult{}, catalogRegistryNameWriteError(err)
		}
	} else {
		var lockedVersion int
		err = tx.QueryRowContext(ctx, "SELECT version FROM dsh.catalog_shopping_shortcuts WHERE id=$1 FOR UPDATE", input.ID).Scan(&lockedVersion)
		if errors.Is(err, sql.ErrNoRows) {
			return ShoppingShortcutResult{}, ErrShoppingShortcutNotFound
		}
		if err != nil {
			return ShoppingShortcutResult{}, err
		}
		if lockedVersion != input.ExpectedVersion {
			return ShoppingShortcutResult{}, ErrCatalogVersionConflict
		}
		before, err = readShoppingShortcutTx(ctx, tx, input.ID)
		if err != nil {
			return ShoppingShortcutResult{}, err
		}
		if before.VerticalID != input.VerticalID || before.Version != input.ExpectedVersion {
			return ShoppingShortcutResult{}, ErrCatalogVersionConflict
		}
		_, err = tx.ExecContext(ctx, `UPDATE dsh.catalog_shopping_shortcuts
            SET title_ar=$2,ordinal=$3,active=$4,version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$5`, input.ID, input.TitleAr, input.Ordinal, input.Active, input.ExpectedVersion)
		if err != nil {
			return ShoppingShortcutResult{}, catalogRegistryNameWriteError(err)
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_shopping_shortcut_targets WHERE shortcut_id=$1", input.ID); err != nil {
			return ShoppingShortcutResult{}, err
		}
	}
	for _, id := range input.StoreTypeIDs {
		if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_shopping_shortcut_targets
           (shortcut_id,vertical_id,store_type_id) VALUES($1,$2,$3)`, input.ID, input.VerticalID, id); err != nil {
			return ShoppingShortcutResult{}, ErrShoppingShortcutInvalid
		}
	}
	for _, id := range input.CategoryIDs {
		if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_shopping_shortcut_targets
           (shortcut_id,vertical_id,category_id) VALUES($1,$2,$3)`, input.ID, input.VerticalID, id); err != nil {
			return ShoppingShortcutResult{}, ErrShoppingShortcutInvalid
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_mutation_idempotency
       (idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'shopping_shortcut',$3)`,
		key, requestHash, input.ID); err != nil {
		return ShoppingShortcutResult{}, err
	}
	item, err := readShoppingShortcutTx(ctx, tx, input.ID)
	if err != nil {
		return ShoppingShortcutResult{}, err
	}
	audit.EntityType, audit.EntityID = "shopping_shortcut", input.ID
	audit.AfterState = item
	if input.ExpectedVersion == 0 {
		audit.Action, audit.ExpectedVersion, audit.ResultingVersion = "CREATED", 0, item.Version
	} else {
		audit.Action, audit.ExpectedVersion, audit.ResultingVersion, audit.BeforeState =
			"UPDATED", input.ExpectedVersion, item.Version, before
	}
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return ShoppingShortcutResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return ShoppingShortcutResult{}, err
	}
	return ShoppingShortcutResult{Shortcut: item}, nil
}
