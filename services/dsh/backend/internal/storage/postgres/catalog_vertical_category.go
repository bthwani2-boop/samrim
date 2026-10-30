package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func CreateCommerceVertical(ctx context.Context, db *sql.DB, item CommerceVerticalRecord, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) (CommerceVerticalResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CommerceVerticalResult{}, err
	}
	var kind, id, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&kind, &id, &storedHash)
	if err == nil {
		if kind != "vertical" || storedHash != requestHash {
			return CommerceVerticalResult{}, ErrCatalogIdempotencyConflict
		}
		item, err = readCommerceVerticalTx(ctx, tx, id)
		if err != nil {
			return CommerceVerticalResult{}, err
		}
		if err = tx.Commit(); err != nil {
			return CommerceVerticalResult{}, err
		}
		return CommerceVerticalResult{Vertical: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalResult{}, err
	}
	if item.ID == "" {
		item.ID, err = newID("vertical")
		if err != nil {
			return CommerceVerticalResult{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en,active) VALUES($1,$2,$3,$4)", item.ID, item.NameAr, item.NameEn, item.Active); err != nil {
		return CommerceVerticalResult{}, catalogRegistryNameWriteError(err)
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'vertical',$3)", idempotencyKey, requestHash, item.ID); err != nil {
		return CommerceVerticalResult{}, err
	}
	item, err = readCommerceVerticalTx(ctx, tx, item.ID)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	audit.EntityType = "vertical"
	audit.EntityID = item.ID
	audit.Action = "CREATED"
	audit.ExpectedVersion = 0
	audit.ResultingVersion = item.Version
	audit.AfterState = item
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return CommerceVerticalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommerceVerticalResult{}, err
	}
	return CommerceVerticalResult{Vertical: item}, nil
}

func CreateCatalogCategory(ctx context.Context, db *sql.DB, item CatalogCategoryRecord, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) (CatalogCategoryRecord, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CatalogCategoryRecord{}, err
	}
	var kind, id, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&kind, &id, &storedHash)
	if err == nil {
		if kind != "category" || storedHash != requestHash {
			return CatalogCategoryRecord{}, ErrCatalogIdempotencyConflict
		}
		item, err = readCatalogCategoryTx(ctx, tx, id)
		if err != nil {
			return CatalogCategoryRecord{}, err
		}
		if err = tx.Commit(); err != nil {
			return CatalogCategoryRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryRecord{}, err
	}
	var activeVertical bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.commerce_verticals WHERE id=$1 AND active=true FOR SHARE)`, item.VerticalID).Scan(&activeVertical); err != nil {
		return CatalogCategoryRecord{}, err
	}
	if !activeVertical {
		return CatalogCategoryRecord{}, ErrCatalogVerticalNotFound
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-category-tree:"+item.VerticalID); err != nil {
		return CatalogCategoryRecord{}, err
	}
	if item.Active && item.ParentCategoryID != "" {
		var hasInactiveParentPath bool
		err = tx.QueryRowContext(ctx, `WITH RECURSIVE parent_path(id,parent_category_id,active) AS (
			SELECT id,parent_category_id,active FROM dsh.catalog_categories WHERE id=$1 AND vertical_id=$2
			UNION
			SELECT parent.id,parent.parent_category_id,parent.active
			FROM dsh.catalog_categories parent JOIN parent_path child ON parent.id=child.parent_category_id AND parent.vertical_id=$2
		) SELECT EXISTS(SELECT 1 FROM parent_path WHERE NOT active)`, item.ParentCategoryID, item.VerticalID).Scan(&hasInactiveParentPath)
		if err != nil {
			return CatalogCategoryRecord{}, err
		}
		var parentExists bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.catalog_categories WHERE id=$1 AND vertical_id=$2)", item.ParentCategoryID, item.VerticalID).Scan(&parentExists); err != nil {
			return CatalogCategoryRecord{}, err
		}
		if !parentExists {
			return CatalogCategoryRecord{}, ErrCatalogCategoryNotFound
		}
		if hasInactiveParentPath {
			return CatalogCategoryRecord{}, ErrCatalogCategoryParentInactive
		}
	}
	if item.ID == "" {
		item.ID, err = newID("category")
		if err != nil {
			return CatalogCategoryRecord{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_categories(id,vertical_id,parent_category_id,name_ar,name_en,active) VALUES($1,$2,NULLIF($3,''),$4,$5,$6)", item.ID, item.VerticalID, item.ParentCategoryID, item.NameAr, item.NameEn, item.Active); err != nil {
		return CatalogCategoryRecord{}, catalogRegistryNameWriteError(err)
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'category',$3)", idempotencyKey, requestHash, item.ID); err != nil {
		return CatalogCategoryRecord{}, err
	}
	item, err = readCatalogCategoryTx(ctx, tx, item.ID)
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	audit.EntityType = "category"
	audit.EntityID = item.ID
	audit.Action = "CREATED"
	audit.ExpectedVersion = 0
	audit.ResultingVersion = item.Version
	audit.AfterState = item
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return CatalogCategoryRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogCategoryRecord{}, err
	}
	return item, nil
}

func UpdateCommerceVertical(ctx context.Context, db *sql.DB, verticalID string, input UpdateCommerceVerticalInput, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) (CommerceVerticalResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CommerceVerticalResult{}, err
	}
	var kind, entityID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&kind, &entityID, &storedHash)
	if err == nil {
		if kind != "vertical" || entityID != verticalID || storedHash != requestHash {
			return CommerceVerticalResult{}, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCommerceVerticalTx(ctx, tx, entityID)
		if readErr != nil {
			return CommerceVerticalResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CommerceVerticalResult{}, err
		}
		return CommerceVerticalResult{Vertical: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalResult{}, err
	}
	before, err := readCommerceVerticalForUpdateTx(ctx, tx, verticalID)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	if before.Version != input.ExpectedVersion {
		return CommerceVerticalResult{}, ErrCatalogVersionConflict
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dsh.commerce_verticals SET name_ar=$2,name_en=$3,active=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$5`, verticalID, input.NameAr, input.NameEn, input.Active, input.ExpectedVersion); err != nil {
		return CommerceVerticalResult{}, catalogRegistryNameWriteError(err)
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'vertical',$3)", idempotencyKey, requestHash, verticalID); err != nil {
		return CommerceVerticalResult{}, err
	}
	after, err := readCommerceVerticalTx(ctx, tx, verticalID)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	audit.EntityType, audit.EntityID, audit.Action = "vertical", verticalID, "UPDATED"
	audit.ExpectedVersion, audit.ResultingVersion = input.ExpectedVersion, after.Version
	audit.BeforeState, audit.AfterState = before, after
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return CommerceVerticalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommerceVerticalResult{}, err
	}
	return CommerceVerticalResult{Vertical: after}, nil
}

func UpdateCatalogCategory(ctx context.Context, db *sql.DB, categoryID string, input UpdateCatalogCategoryInput, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) (CatalogCategoryRecord, bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	var kind, entityID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&kind, &entityID, &storedHash)
	if err == nil {
		if kind != "category" || entityID != categoryID || storedHash != requestHash {
			return CatalogCategoryRecord{}, false, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCatalogCategoryTx(ctx, tx, entityID)
		if readErr != nil {
			return CatalogCategoryRecord{}, false, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogCategoryRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryRecord{}, false, err
	}
	before, err := readCatalogCategoryTx(ctx, tx, categoryID)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	var activeVertical bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.commerce_verticals WHERE id=$1 AND active=true FOR SHARE)`, before.VerticalID).Scan(&activeVertical); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if !activeVertical {
		return CatalogCategoryRecord{}, false, ErrCatalogVerticalNotFound
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-category-tree:"+before.VerticalID); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	before, err = readCatalogCategoryForUpdateTx(ctx, tx, categoryID)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if before.Version != input.ExpectedVersion {
		return CatalogCategoryRecord{}, false, ErrCatalogVersionConflict
	}
	if input.ParentCategoryID != "" {
		var parentVertical string
		if err = tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1", input.ParentCategoryID).Scan(&parentVertical); errors.Is(err, sql.ErrNoRows) {
			return CatalogCategoryRecord{}, false, ErrCatalogCategoryNotFound
		} else if err != nil {
			return CatalogCategoryRecord{}, false, err
		}
		if parentVertical != before.VerticalID {
			return CatalogCategoryRecord{}, false, ErrCatalogCategoryNotFound
		}
		var createsCycle bool
		err = tx.QueryRowContext(ctx, `WITH RECURSIVE ancestors(id,parent_category_id) AS (
			SELECT id,parent_category_id FROM dsh.catalog_categories WHERE id=$1
			UNION
			SELECT parent.id,parent.parent_category_id FROM dsh.catalog_categories parent JOIN ancestors child ON parent.id=child.parent_category_id
		) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$2)`, input.ParentCategoryID, categoryID).Scan(&createsCycle)
		if err != nil {
			return CatalogCategoryRecord{}, false, err
		}
		if createsCycle {
			return CatalogCategoryRecord{}, false, ErrCatalogCategoryCycle
		}
		if input.Active {
			var hasInactiveParentPath bool
			if err = tx.QueryRowContext(ctx, `WITH RECURSIVE parent_path(id,parent_category_id,active) AS (
				SELECT id,parent_category_id,active FROM dsh.catalog_categories WHERE id=$1 AND vertical_id=$2
				UNION
				SELECT parent.id,parent.parent_category_id,parent.active
				FROM dsh.catalog_categories parent JOIN parent_path child ON parent.id=child.parent_category_id AND parent.vertical_id=$2
			) SELECT EXISTS(SELECT 1 FROM parent_path WHERE NOT active)`, input.ParentCategoryID, before.VerticalID).Scan(&hasInactiveParentPath); err != nil {
				return CatalogCategoryRecord{}, false, err
			}
			if hasInactiveParentPath {
				return CatalogCategoryRecord{}, false, ErrCatalogCategoryParentInactive
			}
		}
	}
	if !input.Active && before.Active {
		var hasActiveDescendants bool
		err = tx.QueryRowContext(ctx, `WITH RECURSIVE descendants(id,parent_category_id,active) AS (
			SELECT id,parent_category_id,active FROM dsh.catalog_categories WHERE parent_category_id=$1 AND vertical_id=$2
			UNION
			SELECT child.id,child.parent_category_id,child.active
			FROM dsh.catalog_categories child JOIN descendants parent ON child.parent_category_id=parent.id AND child.vertical_id=$2
		) SELECT EXISTS(SELECT 1 FROM descendants WHERE active)`, categoryID, before.VerticalID).Scan(&hasActiveDescendants)
		if err != nil {
			return CatalogCategoryRecord{}, false, err
		}
		if hasActiveDescendants {
			return CatalogCategoryRecord{}, false, ErrCatalogCategoryHasActiveChildren
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dsh.catalog_categories SET parent_category_id=NULLIF($2,''),name_ar=$3,name_en=$4,active=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$6`, categoryID, input.ParentCategoryID, input.NameAr, input.NameEn, input.Active, input.ExpectedVersion); err != nil {
		return CatalogCategoryRecord{}, false, catalogRegistryNameWriteError(err)
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'category',$3)", idempotencyKey, requestHash, categoryID); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	after, err := readCatalogCategoryTx(ctx, tx, categoryID)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	audit.EntityType, audit.EntityID, audit.Action = "category", categoryID, "UPDATED"
	audit.ExpectedVersion, audit.ResultingVersion = input.ExpectedVersion, after.Version
	audit.BeforeState, audit.AfterState = before, after
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	return after, false, nil
}

func readCommerceVerticalForUpdateTx(ctx context.Context, tx *sql.Tx, id string) (CommerceVerticalRecord, error) {
	var item CommerceVerticalRecord
	err := tx.QueryRowContext(ctx, `SELECT id,name_ar,name_en,COALESCE(image_uri,''),active,version,created_at,updated_at FROM dsh.commerce_verticals WHERE id=$1 FOR UPDATE`, id).Scan(&item.ID, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalRecord{}, ErrCatalogVerticalNotFound
	}
	return item, err
}

func readCatalogCategoryForUpdateTx(ctx context.Context, tx *sql.Tx, id string) (CatalogCategoryRecord, error) {
	var item CatalogCategoryRecord
	var parent sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT category.id,category.vertical_id,category.parent_category_id,category.name_ar,category.name_en,
		COALESCE((SELECT asset.uri FROM dsh.catalog_category_media_assets asset WHERE asset.category_id=category.id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),''),
		category.active,category.version,category.created_at,category.updated_at FROM dsh.catalog_categories category WHERE category.id=$1 AND category.deleted_at IS NULL FOR UPDATE`, id).Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryRecord{}, ErrCatalogCategoryNotFound
	}
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	if parent.Valid {
		item.ParentCategoryID = parent.String
	}
	return item, nil
}
func readCommerceVerticalTx(ctx context.Context, tx *sql.Tx, id string) (CommerceVerticalRecord, error) {
	var item CommerceVerticalRecord
	err := tx.QueryRowContext(ctx, "SELECT id,name_ar,name_en,COALESCE(image_uri,''),active,version,created_at,updated_at FROM dsh.commerce_verticals WHERE id=$1", id).Scan(&item.ID, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}
func readCatalogCategoryTx(ctx context.Context, tx *sql.Tx, id string) (CatalogCategoryRecord, error) {
	var item CatalogCategoryRecord
	var parent sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT category.id,category.vertical_id,category.parent_category_id,category.name_ar,category.name_en,
		COALESCE((SELECT asset.uri FROM dsh.catalog_category_media_assets asset WHERE asset.category_id=category.id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),''),
		category.active,category.version,category.created_at,category.updated_at FROM dsh.catalog_categories category WHERE category.id=$1 AND category.deleted_at IS NULL`, id).Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if parent.Valid {
		item.ParentCategoryID = parent.String
	}
	return item, err
}
func ListCommerceVerticals(ctx context.Context, db *sql.DB, activeOnly bool) ([]CommerceVerticalRecord, error) {
	where := ""
	if activeOnly {
		where = " WHERE active=true"
	}
	rows, err := db.QueryContext(ctx, "SELECT id,name_ar,name_en,COALESCE(image_uri,''),active,version,created_at,updated_at FROM dsh.commerce_verticals"+where+" ORDER BY lower(name_en),id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CommerceVerticalRecord{}
	for rows.Next() {
		var item CommerceVerticalRecord
		if err = rows.Scan(&item.ID, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func ReadCommerceVertical(ctx context.Context, db *sql.DB, id string) (CommerceVerticalRecord, error) {
	var item CommerceVerticalRecord
	err := db.QueryRowContext(ctx, "SELECT id,name_ar,name_en,COALESCE(image_uri,''),active,version,created_at,updated_at FROM dsh.commerce_verticals WHERE id=$1", strings.TrimSpace(id)).Scan(&item.ID, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalRecord{}, ErrCatalogVerticalNotFound
	}
	return item, err
}

type catalogCategoryCursor struct {
	Version    int       `json:"v"`
	VerticalID string    `json:"verticalId"`
	Query      string    `json:"query"`
	Status     string    `json:"status"`
	Sort       string    `json:"sort"`
	NameKey    string    `json:"nameKey,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
	CategoryID string    `json:"categoryId"`
}

func encodeCatalogCategoryCursor(cursor catalogCategoryCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeCatalogCategoryCursor(raw, verticalID, query, status, sort string) (*catalogCategoryCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogCategoryInvalidCursor
	}
	var cursor catalogCategoryCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.Version != 1 || cursor.CategoryID == "" || cursor.VerticalID != verticalID || cursor.Query != query || cursor.Status != status || cursor.Sort != sort || (sort == "updated_desc" && cursor.UpdatedAt.IsZero()) || (sort != "updated_desc" && cursor.NameKey == "") {
		return nil, ErrCatalogCategoryInvalidCursor
	}
	return &cursor, nil
}

func ListCatalogCategoryPage(ctx context.Context, db *sql.DB, verticalID, query, status, sort string, limit int, rawCursor string) (CatalogCategoryPage, error) {
	verticalID = strings.TrimSpace(verticalID)
	query = strings.TrimSpace(query)
	status = strings.TrimSpace(status)
	sort = strings.TrimSpace(sort)
	if len(verticalID) > 128 || len(query) > 160 || (status != "all" && status != "active" && status != "inactive") || (sort != "name_asc" && sort != "name_desc" && sort != "updated_desc") || limit < 1 || limit > 100 || len(rawCursor) > 2048 {
		return CatalogCategoryPage{}, ErrCatalogCategoryInvalidCursor
	}
	cursor, err := decodeCatalogCategoryCursor(rawCursor, verticalID, query, status, sort)
	if err != nil {
		return CatalogCategoryPage{}, err
	}
	var verticalExists bool
	if verticalID != "" {
		if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.commerce_verticals WHERE id=$1)", verticalID).Scan(&verticalExists); err != nil {
			return CatalogCategoryPage{}, err
		} else if !verticalExists {
			return CatalogCategoryPage{}, ErrCatalogVerticalNotFound
		}
	}
	queryPattern := ""
	if query != "" {
		queryPattern = "%" + strings.TrimSuffix(escapeCatalogSearchPrefix(query), "%") + "%"
	}
	var cursorUpdatedAt any
	var cursorNameKey string
	var cursorCategoryID string
	if cursor != nil {
		cursorUpdatedAt = cursor.UpdatedAt
		cursorNameKey = cursor.NameKey
		cursorCategoryID = cursor.CategoryID
	}
	const statement = `WITH RECURSIVE page AS MATERIALIZED (
		SELECT category.id,category.parent_category_id,category.vertical_id,category.name_ar,category.name_en,
		COALESCE((SELECT asset.uri FROM dsh.catalog_category_media_assets asset WHERE asset.category_id=category.id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),'') AS image_uri,
		category.active,category.version,category.created_at,category.updated_at
		FROM dsh.catalog_categories category
		WHERE ($1='' OR category.vertical_id=$1) AND category.deleted_at IS NULL AND ($2='all' OR category.active=($2='active'))
		AND ($3='' OR category.name_ar ILIKE $3 ESCAPE '!' OR category.name_en ILIKE $3 ESCAPE '!')
		AND (NOT $7::boolean
			OR ($8='updated_desc' AND (category.updated_at,category.id)<($4::timestamptz,$6::text))
			OR ($8='name_asc' AND (lower(category.name_en),category.id)>($5::text,$6::text))
			OR ($8='name_desc' AND (lower(category.name_en),category.id)<($5::text,$6::text)))
		ORDER BY CASE WHEN $8='name_asc' THEN lower(category.name_en) END ASC,CASE WHEN $8='name_desc' THEN lower(category.name_en) END DESC,
		CASE WHEN $8='updated_desc' THEN category.updated_at END DESC,CASE WHEN $8='name_asc' THEN category.id END ASC,CASE WHEN $8 IN ('name_desc','updated_desc') THEN category.id END DESC
		LIMIT $9
	), ancestors AS (
		SELECT page.id AS leaf_id, category.id, category.parent_category_id, category.vertical_id, category.name_ar, category.name_en, 0 AS depth, ARRAY[category.id] AS visited
		FROM page JOIN dsh.catalog_categories category ON category.id=page.id
		UNION ALL
		SELECT ancestors.leaf_id, parent.id, parent.parent_category_id, parent.vertical_id, parent.name_ar, parent.name_en, ancestors.depth+1, ancestors.visited || parent.id
		FROM ancestors JOIN dsh.catalog_categories parent ON parent.id=ancestors.parent_category_id AND parent.vertical_id=ancestors.vertical_id
		WHERE NOT parent.id=ANY(ancestors.visited)
	)
	SELECT page.id,page.vertical_id,page.parent_category_id,page.name_ar,page.name_en,COALESCE(page.image_uri,''),page.active,page.version,page.created_at,page.updated_at,
		COALESCE((SELECT string_agg(ancestor.name_ar,' / ' ORDER BY ancestor.depth DESC) FROM ancestors ancestor WHERE ancestor.leaf_id=page.id),page.name_ar),
		COALESCE((SELECT string_agg(ancestor.name_en,' / ' ORDER BY ancestor.depth DESC) FROM ancestors ancestor WHERE ancestor.leaf_id=page.id),page.name_en),
		lower(page.name_en)
	FROM page
	ORDER BY CASE WHEN $8='name_asc' THEN lower(page.name_en) END ASC,CASE WHEN $8='name_desc' THEN lower(page.name_en) END DESC,
	CASE WHEN $8='updated_desc' THEN page.updated_at END DESC,CASE WHEN $8='name_asc' THEN page.id END ASC,CASE WHEN $8 IN ('name_desc','updated_desc') THEN page.id END DESC`
	rows, err := db.QueryContext(ctx, statement, verticalID, status, queryPattern, cursorUpdatedAt, cursorNameKey, cursorCategoryID, cursor != nil, sort, limit+1)
	if err != nil {
		return CatalogCategoryPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogCategoryListItem, 0, limit+1)
	for rows.Next() {
		var item CatalogCategoryListItem
		var parent sql.NullString
		if err := rows.Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.PathAr, &item.PathEn, &item.sortNameKey); err != nil {
			return CatalogCategoryPage{}, err
		}
		if parent.Valid {
			item.ParentCategoryID = parent.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogCategoryPage{}, err
	}
	page := CatalogCategoryPage{Categories: items}
	if len(items) > limit {
		page.Categories = items[:limit]
		last := page.Categories[len(page.Categories)-1]
		next := catalogCategoryCursor{Version: 1, VerticalID: verticalID, Query: query, Status: status, Sort: sort, CategoryID: last.ID}
		if sort == "updated_desc" {
			next.UpdatedAt = last.UpdatedAt
		} else {
			next.NameKey = last.sortNameKey
		}
		page.NextCursor, err = encodeCatalogCategoryCursor(next)
		if err != nil {
			return CatalogCategoryPage{}, err
		}
	}
	return page, nil
}

func ReadCatalogCategoryForRegistry(ctx context.Context, db *sql.DB, categoryID string) (CatalogCategoryListItem, error) {
	categoryID = strings.TrimSpace(categoryID)
	if categoryID == "" {
		return CatalogCategoryListItem{}, ErrCatalogCategoryNotFound
	}
	var item CatalogCategoryListItem
	var parent sql.NullString
	err := db.QueryRowContext(ctx, `WITH RECURSIVE ancestors AS (
		SELECT category.id AS leaf_id,category.id,category.parent_category_id,category.vertical_id,category.name_ar,category.name_en,0 AS depth,ARRAY[category.id] AS visited
		FROM dsh.catalog_categories category WHERE category.id=$1
		UNION ALL
		SELECT ancestors.leaf_id,parent.id,parent.parent_category_id,parent.vertical_id,parent.name_ar,parent.name_en,ancestors.depth+1,ancestors.visited || parent.id
		FROM ancestors JOIN dsh.catalog_categories parent ON parent.id=ancestors.parent_category_id AND parent.vertical_id=ancestors.vertical_id
		WHERE NOT parent.id=ANY(ancestors.visited)
	)
	SELECT category.id,category.vertical_id,category.parent_category_id,category.name_ar,category.name_en,
		COALESCE((SELECT asset.uri FROM dsh.catalog_category_media_assets asset WHERE asset.category_id=category.id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),''),category.active,category.version,category.created_at,category.updated_at,
		COALESCE((SELECT string_agg(ancestor.name_ar,' / ' ORDER BY ancestor.depth DESC) FROM ancestors ancestor WHERE ancestor.leaf_id=category.id),category.name_ar),
		COALESCE((SELECT string_agg(ancestor.name_en,' / ' ORDER BY ancestor.depth DESC) FROM ancestors ancestor WHERE ancestor.leaf_id=category.id),category.name_en)
	FROM dsh.catalog_categories category WHERE category.id=$1 AND category.deleted_at IS NULL`, categoryID).Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.PathAr, &item.PathEn)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryListItem{}, ErrCatalogCategoryNotFound
	}
	if err != nil {
		return CatalogCategoryListItem{}, err
	}
	if parent.Valid {
		item.ParentCategoryID = parent.String
	}
	return item, nil
}
