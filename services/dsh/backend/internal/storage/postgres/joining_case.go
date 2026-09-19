package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var (
	ErrJoiningCaseNotFound        = errors.New("joining case was not found")
	ErrJoiningCaseIdempotency     = errors.New("joining case idempotency key was already used with different facts")
	ErrJoiningCaseVersion         = errors.New("joining case version is stale")
	ErrJoiningCaseState           = errors.New("joining case state does not allow this transition")
	ErrJoiningCaseActor           = errors.New("partner actor is already bound to another joining case")
	ErrJoiningCaseRebind          = errors.New("joining case partner actor cannot be rebound")
	ErrJoiningCaseSelfReview      = errors.New("joining case cannot be reviewed by its partner actor")
	ErrJoiningCaseExists          = errors.New("an active joining case already exists for this phone")
	ErrJoiningCaseStoreExists     = errors.New("partner already has a canonical store")
	ErrJoiningCaseInvalidDecision = errors.New("joining case review decision is invalid")
	ErrJoiningCasePartnerAccess   = errors.New("partner does not own this joining case")
	ErrJoiningCaseInvalidState    = errors.New("joining case queue state is invalid")
	ErrJoiningCaseInvalidCursor   = errors.New("joining case queue cursor is invalid")
	ErrJoiningCaseInvalidLimit    = errors.New("joining case queue limit is invalid")
	ErrJoiningCaseServiceCity     = errors.New("joining case requires an active service city")
	ErrJoiningCaseStoreOrigin     = errors.New("joining case requires a fixed store origin")
)

type JoiningCaseRecord struct {
	ID                      string
	ContactPhoneE164        string
	BusinessName            string
	FirstStoreName          string
	FirstStoreServiceCityID string
	FirstStoreVerticalID    string
	FirstStoreLatitude      *float64
	FirstStoreLongitude     *float64
	PartnerActorID          string
	OriginatingFieldActorID string
	State                   string
	CorrectionReason        string
	ReviewedBy              string
	StoreID                 string
	Store                   *StoreRecord
	Version                 int
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type JoiningCaseResult struct {
	Case     JoiningCaseRecord
	Replayed bool
}

type JoiningCaseListResult struct {
	Cases      []JoiningCaseRecord
	NextCursor string
}

func HashJoiningCaseRequest(phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64) string {
	return hashFacts(phone, businessName, firstStoreName, serviceCityID, verticalID, formatCoordinate(latitude), formatCoordinate(longitude))
}

func HashJoiningCaseSubmit(caseID, actorID string, expectedVersion int) string {
	return hashFacts(caseID, actorID, strconv.Itoa(expectedVersion))
}

func HashJoiningCaseCorrectAndResubmit(caseID, actorID, businessName, firstStoreName string, expectedVersion int, serviceCityID, verticalID string, latitude, longitude float64) string {
	return hashFacts("correct-and-resubmit", caseID, actorID, businessName, firstStoreName, strconv.Itoa(expectedVersion), serviceCityID, verticalID, formatCoordinate(latitude), formatCoordinate(longitude))
}

func HashJoiningCaseReview(caseID, decision, correctionReason string, expectedVersion int) string {
	return hashFacts(caseID, decision, correctionReason, strconv.Itoa(expectedVersion))
}

func CreateJoiningCase(ctx context.Context, db *sql.DB, idempotencyKey, requestHash, actingActorID, correlationID, phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64) (JoiningCaseResult, error) {
	return createJoiningCase(ctx, db, idempotencyKey, requestHash, actingActorID, correlationID, "", phone, businessName, firstStoreName, serviceCityID, verticalID, latitude, longitude)
}

func CreateJoiningCaseForField(ctx context.Context, db *sql.DB, idempotencyKey, requestHash, fieldActorID, correlationID, phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64) (JoiningCaseResult, error) {
	return createJoiningCase(ctx, db, idempotencyKey, requestHash, fieldActorID, correlationID, fieldActorID, phone, businessName, firstStoreName, serviceCityID, verticalID, latitude, longitude)
}

func createJoiningCase(ctx context.Context, db *sql.DB, idempotencyKey, requestHash, actingActorID, correlationID, originatingFieldActorID, phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64) (JoiningCaseResult, error) {
	if db == nil {
		return JoiningCaseResult{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin joining case: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	var storedHash, storedCaseID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash, case_id, operation FROM dsh.joining_case_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedCaseID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return JoiningCaseResult{}, ErrJoiningCaseIdempotency
		}
		result, readErr := readJoiningCaseTx(ctx, tx, storedCaseID)
		if readErr != nil {
			return JoiningCaseResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, fmt.Errorf("read joining case idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:joining-case:phone:"+phone); err != nil {
		return JoiningCaseResult{}, err
	}
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.joining_cases WHERE contact_phone_e164=$1 AND state <> 'approved'", phone).Scan(&existing); err == nil {
		return JoiningCaseResult{}, ErrJoiningCaseExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, err
	}
	cityID := strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	latitude, longitude, err = normalizeLocation(latitude, longitude)
	if err != nil {
		return JoiningCaseResult{}, ErrJoiningCaseStoreOrigin
	}
	caseID, err := newID("join")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,first_store_service_city_id,first_store_vertical_id,first_store_latitude,first_store_longitude,originating_field_actor_id) VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,$8,NULLIF($9,''))`, caseID, phone, businessName, firstStoreName, cityID, verticalID, latitude, longitude, originatingFieldActorID); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("create joining case: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_mutation_idempotency(idempotency_key,request_hash,case_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'draft')`, idempotencyKey, requestHash, caseID); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("record joining case idempotency: %w", err)
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_created", idempotencyKey, correlationID, actingActorID, caseID, "", "draft", 1, requestHash, "", "", ""); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("commit joining case: %w", err)
	}
	result, err := ReadJoiningCase(ctx, db, caseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	result.Replayed = false
	return result, nil
}

func SubmitJoiningCase(ctx context.Context, db *sql.DB, caseID, actorID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (JoiningCaseResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin joining case submission: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, requestHash, caseID, "submit")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	current, err := readJoiningCaseTx(ctx, tx, caseID)
	if errors.Is(err, ErrJoiningCaseNotFound) {
		return JoiningCaseResult{}, err
	}
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if current.Case.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if current.Case.State != "draft" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if current.Case.PartnerActorID != "" && current.Case.PartnerActorID != actorID {
		return JoiningCaseResult{}, ErrJoiningCaseRebind
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:joining-case:actor:"+actorID); err != nil {
		return JoiningCaseResult{}, err
	}
	var existingCase string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.joining_cases WHERE partner_actor_id=$1 AND id<>$2", actorID, caseID).Scan(&existingCase); err == nil {
		return JoiningCaseResult{}, ErrJoiningCaseActor
	} else if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, err
	}
	updated, err := updateJoiningCaseStateTx(ctx, tx, current.Case, "submitted", actorID, "", "", "", expectedVersion)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, requestHash, updated, "submit"); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_submitted", idempotencyKey, correlationID, actingActorID, caseID, current.Case.State, updated.State, updated.Version, requestHash, actorID, "", ""); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

func CorrectAndResubmitJoiningCase(ctx context.Context, db *sql.DB, caseID, actorID, businessName, firstStoreName string, expectedVersion int, idempotencyKey, requestHash, correlationID, serviceCityID, verticalID string, latitude, longitude float64) (JoiningCaseResult, error) {
	if db == nil {
		return JoiningCaseResult{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin joining case correction and resubmission: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, requestHash, caseID, "correct_and_resubmit")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	current, err := readJoiningCaseTx(ctx, tx, caseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if current.Case.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if current.Case.State != "needs_correction" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if current.Case.PartnerActorID == "" || current.Case.PartnerActorID != actorID {
		return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
	}
	cityID := current.Case.FirstStoreServiceCityID
	cityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	latitude, longitude, err = normalizeLocation(latitude, longitude)
	if err != nil {
		return JoiningCaseResult{}, ErrJoiningCaseStoreOrigin
	}
	var updatedID string
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.joining_cases SET business_name=$2,first_store_name=$3,first_store_service_city_id=NULLIF($4,''),first_store_vertical_id=NULLIF($5,''),first_store_latitude=$6,first_store_longitude=$7,state='submitted',correction_reason=NULL,reviewed_by=NULL,store_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND partner_actor_id=$8 AND state='needs_correction' AND version=$9 RETURNING id`, current.Case.ID, businessName, firstStoreName, cityID, verticalID, latitude, longitude, actorID, expectedVersion).Scan(&updatedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, ErrJoiningCaseVersion
		}
		return JoiningCaseResult{}, fmt.Errorf("correct joining case: %w", err)
	}
	updated, err := readJoiningCaseTx(ctx, tx, updatedID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, requestHash, updated.Case, "correct_and_resubmit"); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_corrected_and_resubmitted", idempotencyKey, correlationID, actorID, caseID, current.Case.State, updated.Case.State, updated.Case.Version, requestHash, actorID, "", current.Case.CorrectionReason); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

type joiningCaseCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func ListJoiningCases(ctx context.Context, db *sql.DB, state string, limit int, cursor string) (JoiningCaseListResult, error) {
	if db == nil {
		return JoiningCaseListResult{}, errors.New("DSH database is nil")
	}
	if limit < 1 || limit > 50 {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidLimit
	}
	state = strings.TrimSpace(strings.ToLower(state))
	if state != "" && state != "draft" && state != "submitted" && state != "needs_correction" && state != "approved" {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidState
	}
	var decoded *joiningCaseCursor
	if strings.TrimSpace(cursor) != "" {
		value, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(cursor))
		if err != nil {
			return JoiningCaseListResult{}, ErrJoiningCaseInvalidCursor
		}
		var parsed joiningCaseCursor
		if json.Unmarshal(value, &parsed) != nil || parsed.ID == "" || parsed.CreatedAt.IsZero() {
			return JoiningCaseListResult{}, ErrJoiningCaseInvalidCursor
		}
		decoded = &parsed
	}

	query := `SELECT c.id,c.contact_phone_e164,c.business_name,c.first_store_name,c.partner_actor_id,c.state,c.correction_reason,c.reviewed_by,c.version,c.created_at,c.updated_at,c.first_store_service_city_id,c.first_store_vertical_id,c.first_store_latitude,c.first_store_longitude FROM dsh.joining_cases c WHERE 1=1`
	args := make([]any, 0, 4)
	if state != "" {
		args = append(args, state)
		query += fmt.Sprintf(" AND c.state=$%d", len(args))
	}
	if decoded != nil {
		args = append(args, decoded.CreatedAt, decoded.ID)
		query += fmt.Sprintf(" AND (c.created_at,c.id)>($%d,$%d)", len(args)-1, len(args))
	}
	args = append(args, limit+1)
	query += fmt.Sprintf(" ORDER BY c.created_at ASC,c.id ASC LIMIT $%d", len(args))
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("list joining cases: %w", err)
	}
	defer rows.Close()
	items := make([]JoiningCaseRecord, 0, limit)
	for rows.Next() {
		var record JoiningCaseRecord
		var actorID, correctionReason, reviewedBy, cityID, verticalID sql.NullString
		var latitude, longitude sql.NullFloat64
		if err := rows.Scan(&record.ID, &record.ContactPhoneE164, &record.BusinessName, &record.FirstStoreName, &actorID, &record.State, &correctionReason, &reviewedBy, &record.Version, &record.CreatedAt, &record.UpdatedAt, &cityID, &verticalID, &latitude, &longitude); err != nil {
			return JoiningCaseListResult{}, fmt.Errorf("scan joining case queue: %w", err)
		}
		if actorID.Valid {
			record.PartnerActorID = actorID.String
		}
		if correctionReason.Valid {
			record.CorrectionReason = correctionReason.String
		}
		if reviewedBy.Valid {
			record.ReviewedBy = reviewedBy.String
		}
		if cityID.Valid {
			record.FirstStoreServiceCityID = cityID.String
		}
		if verticalID.Valid {
			record.FirstStoreVerticalID = verticalID.String
		}
		record.FirstStoreLatitude = nullableFloat(latitude)
		record.FirstStoreLongitude = nullableFloat(longitude)
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("read joining case queue: %w", err)
	}
	result := JoiningCaseListResult{Cases: items}
	if len(items) > limit {
		last := items[limit-1]
		result.Cases = items[:limit]
		encoded, err := json.Marshal(joiningCaseCursor{CreatedAt: last.CreatedAt, ID: last.ID})
		if err != nil {
			return JoiningCaseListResult{}, err
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return result, nil
}

func ReviewJoiningCase(ctx context.Context, db *sql.DB, caseID, decision, correctionReason string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (JoiningCaseResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin joining case review: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, requestHash, caseID, "review")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if found {
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	current, err := readJoiningCaseTx(ctx, tx, caseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if current.Case.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if current.Case.State != "submitted" || current.Case.PartnerActorID == "" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if current.Case.FirstStoreServiceCityID == "" {
		return JoiningCaseResult{}, ErrJoiningCaseServiceCity
	}
	if current.Case.FirstStoreVerticalID == "" {
		return JoiningCaseResult{}, ErrCatalogVerticalNotFound
	}
	if current.Case.FirstStoreLatitude == nil || current.Case.FirstStoreLongitude == nil {
		return JoiningCaseResult{}, ErrJoiningCaseStoreOrigin
	}
	var cityActive bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.service_cities WHERE id=$1 FOR SHARE", current.Case.FirstStoreServiceCityID).Scan(&cityActive); errors.Is(err, sql.ErrNoRows) || (err == nil && !cityActive) {
		return JoiningCaseResult{}, ErrJoiningCaseServiceCity
	} else if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("read joining case service city: %w", err)
	}
	if strings.TrimSpace(actingActorID) == current.Case.PartnerActorID {
		return JoiningCaseResult{}, ErrJoiningCaseSelfReview
	}
	decision = strings.ToLower(strings.TrimSpace(decision))
	if decision != "approved" && decision != "needs_correction" {
		return JoiningCaseResult{}, ErrJoiningCaseInvalidDecision
	}
	correctionReason = strings.TrimSpace(correctionReason)
	storeID := ""
	if decision == "approved" {
		var existingStore string
		if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE partner_actor_id=$1 ORDER BY created_at ASC LIMIT 1", current.Case.PartnerActorID).Scan(&existingStore); err == nil {
			return JoiningCaseResult{}, ErrJoiningCaseStoreExists
		} else if !errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, err
		}
		storeID, err = newID("store")
		if err != nil {
			return JoiningCaseResult{}, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,delivery_origin_latitude,delivery_origin_longitude,delivery_origin_version,delivery_origin_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,clock_timestamp())", storeID, current.Case.PartnerActorID, current.Case.FirstStoreName, current.Case.FirstStoreServiceCityID, current.Case.FirstStoreVerticalID, *current.Case.FirstStoreLatitude, *current.Case.FirstStoreLongitude); err != nil {
			return JoiningCaseResult{}, fmt.Errorf("create canonical store: %w", err)
		}
	}
	state := decision
	updated, err := updateJoiningCaseStateTx(ctx, tx, current.Case, state, current.Case.PartnerActorID, actingActorID, correctionReason, storeID, expectedVersion)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, requestHash, updated, "review"); err != nil {
		return JoiningCaseResult{}, err
	}
	eventType := "joining_case_approved"
	if decision == "needs_correction" {
		eventType = "joining_case_needs_correction"
	}
	if err := auditJoiningCaseTx(ctx, tx, eventType, idempotencyKey, correlationID, actingActorID, caseID, current.Case.State, updated.State, updated.Version, requestHash, current.Case.PartnerActorID, storeID, correctionReason); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

func ReadJoiningCase(ctx context.Context, db *sql.DB, caseID string) (JoiningCaseResult, error) {
	if db == nil {
		return JoiningCaseResult{}, errors.New("DSH database is nil")
	}
	caseRecord, err := readJoiningCaseRow(ctx, db.QueryRowContext(ctx, joiningCaseSelect+" WHERE c.id=$1", strings.TrimSpace(caseID)), false)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseNotFound
	}
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("read joining case: %w", err)
	}
	return JoiningCaseResult{Case: caseRecord}, nil
}

func ReadJoiningCaseForPartner(ctx context.Context, db *sql.DB, actorID string) (JoiningCaseResult, error) {
	caseRecord, err := readJoiningCaseRow(ctx, db.QueryRowContext(ctx, joiningCaseSelect+" WHERE c.partner_actor_id=$1", strings.TrimSpace(actorID)), false)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseNotFound
	}
	if err != nil {
		return JoiningCaseResult{}, err
	}
	return JoiningCaseResult{Case: caseRecord}, nil
}

func ReadJoiningCaseForField(ctx context.Context, db *sql.DB, fieldActorID, caseID string) (JoiningCaseResult, error) {
	caseRecord, err := readJoiningCaseRow(ctx, db.QueryRowContext(ctx, joiningCaseSelect+" WHERE c.originating_field_actor_id=$1 AND c.id=$2", strings.TrimSpace(fieldActorID), strings.TrimSpace(caseID)), false)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseNotFound
	}
	if err != nil {
		return JoiningCaseResult{}, err
	}
	return JoiningCaseResult{Case: caseRecord}, nil
}

func ListJoiningCasesForField(ctx context.Context, db *sql.DB, fieldActorID string, limit int) (JoiningCaseListResult, error) {
	if db == nil || strings.TrimSpace(fieldActorID) == "" || limit < 1 || limit > 50 {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidLimit
	}
	rows, err := db.QueryContext(ctx, `SELECT c.id,c.contact_phone_e164,c.business_name,c.first_store_name,c.partner_actor_id,c.originating_field_actor_id,c.state,c.correction_reason,c.reviewed_by,c.version,c.created_at,c.updated_at,c.first_store_service_city_id,c.first_store_vertical_id,c.first_store_latitude,c.first_store_longitude FROM dsh.joining_cases c WHERE c.originating_field_actor_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT $2`, strings.TrimSpace(fieldActorID), limit)
	if err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("list Field joining cases: %w", err)
	}
	defer rows.Close()
	items := make([]JoiningCaseRecord, 0, limit)
	for rows.Next() {
		var record JoiningCaseRecord
		var actorID, originActorID, correctionReason, reviewedBy, cityID, verticalID sql.NullString
		var latitude, longitude sql.NullFloat64
		if err := rows.Scan(&record.ID, &record.ContactPhoneE164, &record.BusinessName, &record.FirstStoreName, &actorID, &originActorID, &record.State, &correctionReason, &reviewedBy, &record.Version, &record.CreatedAt, &record.UpdatedAt, &cityID, &verticalID, &latitude, &longitude); err != nil {
			return JoiningCaseListResult{}, fmt.Errorf("scan Field joining case queue: %w", err)
		}
		if actorID.Valid {
			record.PartnerActorID = actorID.String
		}
		if originActorID.Valid {
			record.OriginatingFieldActorID = originActorID.String
		}
		if correctionReason.Valid {
			record.CorrectionReason = correctionReason.String
		}
		if reviewedBy.Valid {
			record.ReviewedBy = reviewedBy.String
		}
		if cityID.Valid {
			record.FirstStoreServiceCityID = cityID.String
		}
		if verticalID.Valid {
			record.FirstStoreVerticalID = verticalID.String
		}
		record.FirstStoreLatitude = nullableFloat(latitude)
		record.FirstStoreLongitude = nullableFloat(longitude)
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("read Field joining case queue: %w", err)
	}
	return JoiningCaseListResult{Cases: items}, nil
}

const joiningCaseSelect = `SELECT c.id,c.contact_phone_e164,c.business_name,c.first_store_name,c.partner_actor_id,c.originating_field_actor_id,c.state,c.correction_reason,c.reviewed_by,c.store_id,c.version,c.created_at,c.updated_at,c.first_store_service_city_id,c.first_store_vertical_id,c.first_store_latitude,c.first_store_longitude,
	 s.id,s.partner_actor_id,s.name,s.service_city_id,s.primary_vertical_id,s.version,s.publication_state,s.publication_changed_at,s.created_at,s.updated_at,s.delivery_origin_latitude,s.delivery_origin_longitude,s.delivery_origin_version,s.delivery_origin_updated_at FROM dsh.joining_cases c LEFT JOIN dsh.stores s ON s.id=c.store_id`

func readJoiningCaseTx(ctx context.Context, tx *sql.Tx, caseID string) (JoiningCaseResult, error) {
	caseID = strings.TrimSpace(caseID)
	var lockedID string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.joining_cases WHERE id=$1 FOR UPDATE", caseID).Scan(&lockedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, ErrJoiningCaseNotFound
		}
		return JoiningCaseResult{}, err
	}
	record, err := readJoiningCaseRow(ctx, tx.QueryRowContext(ctx, joiningCaseSelect+" WHERE c.id=$1", lockedID), false)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseNotFound
	}
	return JoiningCaseResult{Case: record}, err
}

func readJoiningCaseRow(ctx context.Context, row rowScanner, _ bool) (JoiningCaseRecord, error) {
	var record JoiningCaseRecord
	var actorID, originatingFieldActorID, correctionReason, reviewedBy, storeID, cityID, verticalID sql.NullString
	var latitude, longitude sql.NullFloat64
	var store StoreRecord
	var storeIDValue, storePartner, storeName, storeCityID, storeVerticalID, storeState sql.NullString
	var storeVersion sql.NullInt64
	var storeChanged, storeCreated, storeUpdated, storeOriginUpdated sql.NullTime
	var storeOriginLatitude, storeOriginLongitude sql.NullFloat64
	var storeOriginVersion sql.NullInt64
	err := row.Scan(&record.ID, &record.ContactPhoneE164, &record.BusinessName, &record.FirstStoreName, &actorID, &originatingFieldActorID, &record.State, &correctionReason, &reviewedBy, &storeID, &record.Version, &record.CreatedAt, &record.UpdatedAt, &cityID, &verticalID, &latitude, &longitude,
		&storeIDValue, &storePartner, &storeName, &storeCityID, &storeVerticalID, &storeVersion, &storeState, &storeChanged, &storeCreated, &storeUpdated, &storeOriginLatitude, &storeOriginLongitude, &storeOriginVersion, &storeOriginUpdated)
	if err != nil {
		return JoiningCaseRecord{}, err
	}
	if actorID.Valid {
		record.PartnerActorID = actorID.String
	}
	if originatingFieldActorID.Valid {
		record.OriginatingFieldActorID = originatingFieldActorID.String
	}
	if correctionReason.Valid {
		record.CorrectionReason = correctionReason.String
	}
	if reviewedBy.Valid {
		record.ReviewedBy = reviewedBy.String
	}
	if storeID.Valid {
		record.StoreID = storeID.String
	}
	if cityID.Valid {
		record.FirstStoreServiceCityID = cityID.String
	}
	if verticalID.Valid {
		record.FirstStoreVerticalID = verticalID.String
	}
	record.FirstStoreLatitude = nullableFloat(latitude)
	record.FirstStoreLongitude = nullableFloat(longitude)
	if storeIDValue.Valid {
		store.ID = storeIDValue.String
		store.PartnerActorID = storePartner.String
		store.Name = storeName.String
		store.ServiceCityID = storeCityID.String
		store.PrimaryVerticalID = storeVerticalID.String
		store.Version = int(storeVersion.Int64)
		store.PublicationState = storeState.String
		if storeChanged.Valid {
			value := storeChanged.Time
			store.PublicationChangedAt = &value
		}
		store.CreatedAt = storeCreated.Time
		store.UpdatedAt = storeUpdated.Time
		store.DeliveryOriginLatitude = nullableFloat(storeOriginLatitude)
		store.DeliveryOriginLongitude = nullableFloat(storeOriginLongitude)
		store.DeliveryOriginVersion = int(storeOriginVersion.Int64)
		if storeOriginUpdated.Valid {
			value := storeOriginUpdated.Time
			store.DeliveryOriginUpdatedAt = &value
		}
		record.Store = &store
	}
	return record, nil
}

func nullableFloat(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	result := value.Float64
	return &result
}

func updateJoiningCaseStateTx(ctx context.Context, tx *sql.Tx, current JoiningCaseRecord, state, actorID, reviewedBy, correctionReason, storeID string, expectedVersion int) (JoiningCaseRecord, error) {
	row := tx.QueryRowContext(ctx, `UPDATE dsh.joining_cases SET partner_actor_id=NULLIF($2,''),state=$3,correction_reason=NULLIF($4,''),reviewed_by=NULLIF($5,''),store_id=NULLIF($6,''),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$7 RETURNING id`, current.ID, actorID, state, correctionReason, reviewedBy, storeID, expectedVersion)
	var updatedID string
	if err := row.Scan(&updatedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseRecord{}, ErrJoiningCaseVersion
		}
		return JoiningCaseRecord{}, err
	}
	result, err := readJoiningCaseTx(ctx, tx, updatedID)
	return result.Case, err
}

func recordJoiningCaseMutationTx(ctx context.Context, tx *sql.Tx, idempotencyKey, requestHash string, record JoiningCaseRecord, operation string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_mutation_idempotency(idempotency_key,request_hash,case_id,operation,result_version,result_state,result_partner_actor_id,result_store_id,result_correction_reason) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),NULLIF($9,''))`, idempotencyKey, requestHash, record.ID, operation, record.Version, record.State, record.PartnerActorID, record.StoreID, record.CorrectionReason)
	if err != nil {
		return fmt.Errorf("record joining case mutation: %w", err)
	}
	return nil
}

func readJoiningCaseIdempotency(ctx context.Context, tx *sql.Tx, idempotencyKey, requestHash, caseID, operation string) (JoiningCaseResult, bool, error) {
	var storedHash, storedCaseID, storedOperation string
	err := tx.QueryRowContext(ctx, "SELECT request_hash,case_id,operation FROM dsh.joining_case_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedCaseID, &storedOperation)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, false, nil
	}
	if err != nil {
		return JoiningCaseResult{}, false, err
	}
	if storedHash != requestHash || storedCaseID != caseID || storedOperation != operation {
		return JoiningCaseResult{}, false, ErrJoiningCaseIdempotency
	}
	result, err := readJoiningCaseTx(ctx, tx, caseID)
	return result, true, err
}

func lockJoiningCaseKey(ctx context.Context, tx *sql.Tx, key string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("joining case idempotency key is invalid")
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:joining-case:idempotency:"+key)
	return err
}

func auditJoiningCaseTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, correlationID, actingActorID, caseID, fromState, toState string, resultVersion int, requestHash, partnerActorID, storeID, correctionReason string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_audit(event_type,idempotency_key,correlation_id,acting_actor_id,case_id,from_state,to_state,result_version,request_hash,partner_actor_id,store_id,correction_reason) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''))`, eventType, idempotencyKey, correlationID, actingActorID, caseID, fromState, toState, resultVersion, requestHash, partnerActorID, storeID, correctionReason)
	return err
}

func hashFacts(values ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return hex.EncodeToString(digest[:])
}
