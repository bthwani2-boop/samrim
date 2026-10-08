package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrFieldAdmissionNotFound    = errors.New("field admission was not found")
	ErrFieldAdmissionExists      = errors.New("field admission already exists")
	ErrFieldAdmissionConflict    = errors.New("field admission is in conflict")
	ErrFieldAdmissionNotEligible = errors.New("field admission is not eligible")
	ErrFieldOperationConflict    = errors.New("field operation idempotency key was already used with different facts")
	ErrFieldVersionConflict      = errors.New("field admission version is stale")
	ErrFieldAdmissionRegistry    = errors.New("field admission registry query is invalid")
)

type FieldAdmissionPage struct {
	Admissions []FieldAdmission
	NextCursor string
}

type fieldAdmissionCursor struct {
	Version   int    `json:"v"`
	Query     string `json:"q"`
	State     string `json:"s"`
	Sort      string `json:"o"`
	CityID    string `json:"c,omitempty"`
	CreatedAt string `json:"t"`
	ID        string `json:"i"`
}

type FieldAdmission struct {
	ID                    string
	ActorID               string
	FullNameAr            string
	PhoneE164             string
	WalletProviderKey     string
	AllServiceCities      bool
	ServiceCityIDs        []string
	State                 string
	RequiresProfileReview bool
	Version               int
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

func HashFieldAdmissionRequestScope(fullNameAr, phone string, allServiceCities bool, serviceCityIDs []string, walletProviderKey string) string {
	ids := append([]string(nil), serviceCityIDs...)
	for i := range ids {
		ids[i] = strings.TrimSpace(ids[i])
	}
	return hashFacts("field-admission-v2", strings.TrimSpace(fullNameAr), strings.TrimSpace(phone), strconv.FormatBool(allServiceCities), strings.Join(ids, ","), strings.TrimSpace(walletProviderKey))
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			if _, ok := seen[value]; !ok {
				seen[value] = struct{}{}
				result = append(result, value)
			}
		}
	}
	sort.Strings(result)
	return result
}

func HashFieldAdmissionRequest(fullNameAr, phone, serviceCityID, walletProviderKey string) string {
	return hashFacts("field-admission", strings.TrimSpace(fullNameAr), strings.TrimSpace(phone), strings.TrimSpace(serviceCityID), strings.TrimSpace(walletProviderKey))
}

func HashFieldAdmissionTransition(operation, admissionID string) string {
	return hashFacts("field-admission-"+strings.TrimSpace(operation), strings.TrimSpace(admissionID))
}

func HashFieldAdmissionApprovalRequest(admissionID string, expectedVersion int) string {
	return hashFacts("field-admission-approve", strings.TrimSpace(admissionID), strconv.Itoa(expectedVersion))
}

func HashFieldAdmissionProfileRequest(admissionID, fullNameAr string, expectedVersion int) string {
	return hashFacts("field-admission-profile", strings.TrimSpace(admissionID), strings.TrimSpace(fullNameAr), strconv.Itoa(expectedVersion))
}

func HashFieldAdmissionProfileScopeRequest(admissionID, fullNameAr, walletProviderKey string, allServiceCities bool, serviceCityIDs []string, expectedVersion int) string {
	ids := uniqueSorted(serviceCityIDs)
	return hashFacts("field-admission-profile-v2", strings.TrimSpace(admissionID), strings.TrimSpace(fullNameAr), strings.TrimSpace(walletProviderKey), strconv.FormatBool(allServiceCities), strings.Join(ids, ","), strconv.Itoa(expectedVersion))
}

func HashFieldAdmissionProfileReviewRequest(admissionID string, expectedVersion int) string {
	return hashFacts("field-admission-profile-review", strings.TrimSpace(admissionID), strconv.Itoa(expectedVersion))
}

func HashFieldAccessRequest(actorID string, enabled bool, expectedVersion int) string {
	return hashFacts("field-access", strings.TrimSpace(actorID), strconv.FormatBool(enabled), strconv.Itoa(expectedVersion))
}

func HashJoiningCaseFieldRequest(fieldActorID string, input JoiningCaseRequest) string {
	return hashFacts("field-joining-case", strings.TrimSpace(fieldActorID), strings.TrimSpace(input.Phone), strings.TrimSpace(input.BusinessName), strings.TrimSpace(input.FirstStoreName), strings.TrimSpace(input.ServiceCityID), strings.TrimSpace(input.VerticalID), strings.TrimSpace(input.CommercialTypeID), fmt.Sprintf("%.6f", input.Latitude), fmt.Sprintf("%.6f", input.Longitude), strings.Join(input.FulfillmentModes, ","))
}

type FieldAdmissionCandidateInput struct {
	FullNameAr, Phone, WalletProviderKey string
	AllServiceCities                     bool
	ServiceCityIDs                       []string
	IdempotencyKey, RequestHash          string
	ActingActorID, CorrelationID         string
}

func CreateFieldAdmissionCandidate(ctx context.Context, db *sql.DB, input FieldAdmissionCandidateInput) (FieldAdmission, string, bool, error) {
	fullNameAr := strings.TrimSpace(input.FullNameAr)
	phone := strings.TrimSpace(input.Phone)
	walletProviderKey := strings.TrimSpace(input.WalletProviderKey)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	requestHash := input.RequestHash
	actingActorID := input.ActingActorID
	correlationID := input.CorrelationID
	cityIDs := uniqueSorted(input.ServiceCityIDs)
	if input.AllServiceCities && len(cityIDs) > 0 {
		return FieldAdmission{}, "", false, ErrFieldAdmissionConflict
	}
	if db == nil || len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || phone == "" || (!input.AllServiceCities && len(cityIDs) == 0) || len(cityIDs) > 100 || len([]rune(walletProviderKey)) < 1 || len([]rune(walletProviderKey)) > 64 || idempotencyKey == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, "", false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, "", false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-admission:"+idempotencyKey); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if !input.AllServiceCities {
		for _, cityID := range cityIDs {
			var cityActive bool
			if err := tx.QueryRowContext(ctx, `SELECT active FROM dsh.service_cities WHERE id=$1 FOR SHARE`, cityID).Scan(&cityActive); errors.Is(err, sql.ErrNoRows) {
				return FieldAdmission{}, "", false, ErrServiceCityNotFound
			} else if err != nil {
				return FieldAdmission{}, "", false, err
			} else if !cityActive {
				return FieldAdmission{}, "", false, ErrServiceCityInvalid
			}
		}
	}
	var storedHash, admissionID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &admissionID)
	if err == nil {
		if storedHash != requestHash {
			return FieldAdmission{}, "", false, ErrFieldOperationConflict
		}
		admission, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, "", false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, "", false, err
		}
		return admission, idempotencyKey, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-admission-phone:"+phone); err != nil {
		return FieldAdmission{}, "", false, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.field_admissions WHERE contact_phone_e164=$1 AND state IN ('pending_review','pending_identity') FOR UPDATE", phone).Scan(&existing)
	if err == nil {
		var resumeKey string
		if err := tx.QueryRowContext(ctx, "SELECT idempotency_key FROM dsh.field_admission_idempotency WHERE admission_id=$1 AND operation='create' ORDER BY created_at,idempotency_key LIMIT 1", existing).Scan(&resumeKey); err != nil {
			return FieldAdmission{}, "", false, ErrFieldAdmissionConflict
		}
		admission, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", existing)
		if readErr != nil {
			return FieldAdmission{}, "", false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, "", false, err
		}
		return admission, resumeKey, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, "", false, err
	}
	admissionID, err = newID("field-admission")
	if err != nil {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.field_admissions(id,full_name_ar,contact_phone_e164,all_service_cities,wallet_provider_key,state,version) VALUES($1,$2,$3,$4,$5,'pending_review',1)", admissionID, fullNameAr, phone, input.AllServiceCities, walletProviderKey); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if !input.AllServiceCities {
		for _, cityID := range cityIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_service_cities(admission_id,service_city_id) VALUES($1,$2)`, admissionID, cityID); err != nil {
				return FieldAdmission{}, "", false, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'pending_review')", idempotencyKey, requestHash, admissionID); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,to_state,result_version,request_hash) VALUES('field_admission_created',$1,$2,$3,$4,'pending_review',1,$5)", idempotencyKey, correlationID, actingActorID, admissionID, requestHash); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, "", false, err
	}
	admission, err := ReadFieldAdmission(ctx, db, admissionID)
	return admission, idempotencyKey, false, err
}

func ApproveFieldAdmission(ctx context.Context, db *sql.DB, admissionID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, bool, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id,operation FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != admissionID || operation != "approve" {
			return FieldAdmission{}, false, ErrFieldOperationConflict
		}
		admission, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, false, err
		}
		return admission, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, false, err
	}
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if current.Version != expectedVersion {
		return FieldAdmission{}, false, ErrFieldVersionConflict
	}
	if current.State != "pending_review" || current.FullNameAr == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET state='pending_identity',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_review' AND version=$2 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,version,created_at,updated_at`, admissionID, current.Version).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.Version, &current.CreatedAt, &current.UpdatedAt); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'approve',$4,'pending_identity')`, idempotencyKey, requestHash, admissionID, current.Version); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_approved',$1,$2,$3,$4,'pending_review','pending_identity',$5,$6,$7)`, idempotencyKey, correlationID, actingActorID, admissionID, current.Version-1, current.Version, requestHash); err != nil {
		return FieldAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, false, err
	}
	return current, false, nil
}

func UpdateFieldAdmissionProfile(ctx context.Context, db *sql.DB, admissionID, fullNameAr, walletProviderKey string, allServiceCities bool, serviceCityIDs []string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	walletProviderKey = strings.TrimSpace(walletProviderKey)
	serviceCityIDs = uniqueSorted(serviceCityIDs)
	if allServiceCities && len(serviceCityIDs) > 0 {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	if db == nil || len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || len([]rune(walletProviderKey)) < 1 || len([]rune(walletProviderKey)) > 64 || (!allServiceCities && len(serviceCityIDs) == 0) || len(serviceCityIDs) > 100 || expectedVersion < 1 || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var oldHash, oldID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,admission_id,operation FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&oldHash, &oldID, &operation)
	if err == nil {
		if oldHash != requestHash || oldID != admissionID || operation != "profile" {
			return FieldAdmission{}, false, ErrFieldOperationConflict
		}
		item, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, false, err
	}
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if current.Version != expectedVersion {
		return FieldAdmission{}, false, ErrFieldVersionConflict
	}
	if !allServiceCities {
		for _, cityID := range serviceCityIDs {
			var active bool
			err = tx.QueryRowContext(ctx, `SELECT active FROM dsh.service_cities WHERE id=$1 FOR SHARE`, cityID).Scan(&active)
			if errors.Is(err, sql.ErrNoRows) {
				return FieldAdmission{}, false, ErrServiceCityNotFound
			}
			if err != nil {
				return FieldAdmission{}, false, err
			}
			if !active {
				return FieldAdmission{}, false, ErrServiceCityInvalid
			}
		}
		if len(serviceCityIDs) == 0 {
			return FieldAdmission{}, false, ErrServiceCityInvalid
		}
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET full_name_ar=$2,wallet_provider_key=$3,all_service_cities=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$5 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),COALESCE(wallet_provider_key,''),all_service_cities,state,requires_profile_review,version,created_at,updated_at`, admissionID, fullNameAr, walletProviderKey, allServiceCities, expectedVersion).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.WalletProviderKey, &current.AllServiceCities, &current.State, &current.RequiresProfileReview, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM dsh.field_admission_service_cities WHERE admission_id=$1`, admissionID); err != nil {
		return FieldAdmission{}, false, err
	}
	if !allServiceCities {
		for _, cityID := range serviceCityIDs {
			if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_service_cities(admission_id,service_city_id) VALUES($1,$2)`, admissionID, cityID); err != nil {
				return FieldAdmission{}, false, err
			}
		}
	}
	current.ServiceCityIDs = append([]string(nil), serviceCityIDs...)
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'profile',$4,$5)`, idempotencyKey, requestHash, admissionID, current.Version, current.State); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_profile_updated',$1,$2,$3,$4,$5,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, current.State, expectedVersion, current.Version, requestHash); err != nil {
		return FieldAdmission{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return FieldAdmission{}, false, err
	}
	return current, false, nil
}

func ReviewFieldAdmissionProfile(ctx context.Context, db *sql.DB, admissionID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, bool, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,admission_id,operation FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != admissionID || operation != "profile_review" {
			return FieldAdmission{}, false, ErrFieldOperationConflict
		}
		item, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, false, err
	}
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if current.State != "suspended" || !current.RequiresProfileReview || current.ActorID == "" || current.FullNameAr == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	if current.Version != expectedVersion {
		return FieldAdmission{}, false, ErrFieldVersionConflict
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET requires_profile_review=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='suspended' AND requires_profile_review=true AND version=$2 RETURNING id,actor_id,COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,requires_profile_review,version,created_at,updated_at`, admissionID, current.Version).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.RequiresProfileReview, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state,result_actor_id) VALUES($1,$2,$3,'profile_review',$4,$5,$6)`, idempotencyKey, requestHash, admissionID, current.Version, current.State, current.ActorID); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_profile_reviewed',$1,$2,$3,$4,$5,'suspended','suspended',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, current.ActorID, current.Version-1, current.Version, requestHash); err != nil {
		return FieldAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, false, err
	}
	return current, false, nil
}

func ListFieldAdmissions(ctx context.Context, db *sql.DB, query, state, sort string, limit int, rawCursor string) (FieldAdmissionPage, error) {
	return ListFieldAdmissionsByCity(ctx, db, query, state, sort, "", limit, rawCursor)
}

func ListFieldAdmissionsByCity(ctx context.Context, db *sql.DB, query, state, sort, serviceCityID string, limit int, rawCursor string) (FieldAdmissionPage, error) {
	query, state, sort = strings.TrimSpace(query), strings.TrimSpace(state), strings.TrimSpace(sort)
	serviceCityID = strings.TrimSpace(serviceCityID)
	if state == "all" {
		state = ""
	}
	if state == "" {
		state = "all"
	}
	if sort == "" {
		sort = "created_desc"
	}
	if db == nil || len([]rune(query)) > 100 || len(serviceCityID) > 128 || limit < 1 || limit > 50 || (state != "all" && state != "pending" && state != "pending_review" && state != "pending_identity" && state != "eligible" && state != "suspended" && state != "review_required") || (sort != "created_desc" && sort != "created_asc") {
		return FieldAdmissionPage{}, ErrFieldAdmissionRegistry
	}
	cursor, err := decodeFieldAdmissionCursor(rawCursor, query, state, sort, serviceCityID)
	if err != nil {
		return FieldAdmissionPage{}, err
	}
	var cursorCreatedAt any
	var cursorID string
	if cursor != nil {
		cursorCreatedAt = cursor.CreatedAt
		cursorID = cursor.ID
	}
	rows, err := db.QueryContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),all_service_cities,state,requires_profile_review,version,created_at,updated_at
		FROM dsh.field_admissions
		WHERE ($1='' OR full_name_ar ILIKE '%'||$1||'%' OR COALESCE(contact_phone_e164,'') ILIKE '%'||$1||'%')
		AND ($2='all' OR ($2='pending' AND state IN ('pending_review','pending_identity')) OR ($2='review_required' AND requires_profile_review) OR state=$2)
		AND ($8='' OR (all_service_cities AND EXISTS (SELECT 1 FROM dsh.service_cities sc WHERE sc.id=$8 AND sc.active)) OR EXISTS (SELECT 1 FROM dsh.field_admission_service_cities fc WHERE fc.admission_id=dsh.field_admissions.id AND fc.service_city_id=$8))
		AND (NOT $5::boolean OR ($6='created_asc' AND (created_at,id)>($3::timestamptz,$4)) OR ($6='created_desc' AND (created_at,id)<($3::timestamptz,$4)))
		ORDER BY CASE WHEN $6='created_asc' THEN created_at END ASC,CASE WHEN $6='created_desc' THEN created_at END DESC,
		CASE WHEN $6='created_asc' THEN id END ASC,CASE WHEN $6='created_desc' THEN id END DESC
		LIMIT $7`, query, state, cursorCreatedAt, cursorID, cursor != nil, sort, limit+1, serviceCityID)
	if err != nil {
		return FieldAdmissionPage{}, err
	}
	defer rows.Close()
	items := make([]FieldAdmission, 0, limit+1)
	for rows.Next() {
		var v FieldAdmission
		if err := rows.Scan(&v.ID, &v.ActorID, &v.FullNameAr, &v.PhoneE164, &v.AllServiceCities, &v.State, &v.RequiresProfileReview, &v.Version, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return FieldAdmissionPage{}, err
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return FieldAdmissionPage{}, err
	}
	if err := rows.Close(); err != nil {
		return FieldAdmissionPage{}, err
	}
	for i := range items {
		items[i].ServiceCityIDs, err = fieldAdmissionCityIDs(ctx, db, items[i].ID)
		if err != nil {
			return FieldAdmissionPage{}, err
		}
	}
	page := FieldAdmissionPage{Admissions: items}
	if len(items) > limit {
		page.Admissions = items[:limit]
		last := page.Admissions[len(page.Admissions)-1]
		b, _ := json.Marshal(fieldAdmissionCursor{Version: 1, Query: query, State: state, Sort: sort, CityID: serviceCityID, CreatedAt: last.CreatedAt.UTC().Format(time.RFC3339Nano), ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	return page, nil
}

func decodeFieldAdmissionCursor(raw, query, state, sort, serviceCityID string) (*fieldAdmissionCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrFieldAdmissionRegistry
	}
	var c fieldAdmissionCursor
	if json.Unmarshal(b, &c) != nil || c.Version != 1 || c.Query != query || c.State != state || c.Sort != sort || c.CityID != serviceCityID || c.ID == "" || c.CreatedAt == "" {
		return nil, ErrFieldAdmissionRegistry
	}
	if _, err = time.Parse(time.RFC3339Nano, c.CreatedAt); err != nil {
		return nil, ErrFieldAdmissionRegistry
	}
	return &c, nil
}

func BindFieldAdmission(ctx context.Context, db *sql.DB, admissionID, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, err
	}
	if current.State == "eligible" && current.ActorID == actorID {
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, err
		}
		return current, nil
	}
	if current.State != "pending_identity" || current.ActorID != "" {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	var updated FieldAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET actor_id=$2,contact_phone_e164=NULL,state='eligible',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_identity' AND version=$3 RETURNING id,actor_id,COALESCE(full_name_ar,''),'',state,version,created_at,updated_at`, admissionID, actorID, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.FullNameAr, &updated.PhoneE164, &updated.State, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state,result_actor_id) VALUES($1,$4,$5,'bind',$2,'eligible',$3)`, idempotencyKey, updated.Version, actorID, requestHash, admissionID); err != nil {
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_bound',$1,$2,$3,$4,$5,'pending_identity','eligible',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, current.Version, updated.Version, requestHash); err != nil {
		return FieldAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, err
	}
	return updated, nil
}

func LockFieldLifecycle(ctx context.Context, db *sql.DB, actorID string) (*sql.Tx, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" {
		return nil, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-lifecycle:"+actorID); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func ReadFieldAdmission(ctx context.Context, db *sql.DB, admissionID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	return readFieldAdmissionTx(ctx, db, "id=$1", strings.TrimSpace(admissionID))
}

func ReadFieldAdmissionForActor(ctx context.Context, db *sql.DB, actorID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	return readFieldAdmissionTx(ctx, db, "actor_id=$1", strings.TrimSpace(actorID))
}

func SuspendFieldAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	return transitionFieldAdmission(ctx, db, actorID, "suspended", "field_admission_suspended", idempotencyKey, requestHash, actingActorID, correlationID)
}

func RestoreFieldAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	return transitionFieldAdmission(ctx, db, actorID, "eligible", "field_admission_restored", idempotencyKey, requestHash, actingActorID, correlationID)
}

func transitionFieldAdmission(ctx context.Context, db *sql.DB, actorID, targetState, eventType, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if replay, err := fieldAdmissionAccessReplayTx(ctx, tx, eventType, idempotencyKey, requestHash); err != nil {
		return FieldAdmission{}, err
	} else if replay {
		admission, readErr := readFieldAdmissionTx(ctx, tx, "actor_id=$1", actorID)
		if readErr != nil {
			return FieldAdmission{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, err
		}
		return admission, nil
	}
	current, err := readFieldAdmissionTx(ctx, tx, "actor_id=$1 FOR UPDATE", actorID)
	if err != nil {
		return FieldAdmission{}, err
	}
	if current.State == targetState {
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, err
		}
		return current, nil
	}
	if (targetState == "suspended" && current.State != "eligible") || (targetState == "eligible" && (current.State != "suspended" || current.RequiresProfileReview || current.FullNameAr == "")) {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	var updated FieldAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state=$3 AND version=$4 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,requires_profile_review,version,created_at,updated_at`, current.ID, targetState, current.State, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.FullNameAr, &updated.PhoneE164, &updated.State, &updated.RequiresProfileReview, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return FieldAdmission{}, ErrFieldVersionConflict
		}
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, eventType, idempotencyKey, correlationID, actingActorID, current.ID, actorID, current.State, targetState, current.Version, updated.Version, requestHash); err != nil {
		return FieldAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, err
	}
	return updated, nil
}

func fieldAdmissionAccessReplayTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, requestHash string) (bool, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:field-access:"+idempotencyKey); err != nil {
		return false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_type,request_hash FROM dsh.field_admission_audit WHERE idempotency_key=$1 ORDER BY id FOR UPDATE`, idempotencyKey)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	count := 0
	matching := false
	for rows.Next() {
		var storedEventType, storedHash string
		if err := rows.Scan(&storedEventType, &storedHash); err != nil {
			return false, err
		}
		count++
		matching = matching || (storedEventType == eventType && storedHash == requestHash)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}
	if count != 1 || !matching {
		return false, ErrFieldOperationConflict
	}
	return true, nil
}

func readFieldAdmissionTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, where string, args ...any) (FieldAdmission, error) {
	var item FieldAdmission
	err := source.QueryRowContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),COALESCE(wallet_provider_key,''),all_service_cities,state,requires_profile_review,version,created_at,updated_at FROM dsh.field_admissions WHERE `+where, args...).Scan(&item.ID, &item.ActorID, &item.FullNameAr, &item.PhoneE164, &item.WalletProviderKey, &item.AllServiceCities, &item.State, &item.RequiresProfileReview, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	if err != nil {
		return item, err
	}
	item.ServiceCityIDs, err = fieldAdmissionCityIDs(ctx, source, item.ID)
	if err != nil {
		return FieldAdmission{}, err
	}
	return item, nil
}

func fieldAdmissionCityIDs(ctx context.Context, source interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, admissionID string) ([]string, error) {
	rows, err := source.QueryContext(ctx, `SELECT service_city_id FROM dsh.field_admission_service_cities WHERE admission_id=$1 ORDER BY service_city_id`, admissionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var cityID string
		if err := rows.Scan(&cityID); err != nil {
			return nil, err
		}
		ids = append(ids, cityID)
	}
	return ids, rows.Err()
}
