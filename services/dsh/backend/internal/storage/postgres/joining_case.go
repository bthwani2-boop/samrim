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
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
)

var (
	ErrJoiningCaseNotFound             = errors.New("joining case was not found")
	ErrJoiningCaseIdempotency          = errors.New("joining case idempotency key was already used with different facts")
	ErrJoiningCaseVersion              = errors.New("joining case version is stale")
	ErrJoiningCaseState                = errors.New("joining case state does not allow this transition")
	ErrJoiningCaseActor                = errors.New("partner actor is already bound to another joining case")
	ErrJoiningCaseRebind               = errors.New("joining case partner actor cannot be rebound")
	ErrJoiningCaseSelfReview           = errors.New("joining case cannot be reviewed by its partner actor")
	ErrJoiningCaseExists               = errors.New("an active joining case already exists for this phone")
	ErrJoiningCaseStoreExists          = errors.New("partner already has a canonical store")
	ErrJoiningCaseInvalidDecision      = errors.New("joining case review decision is invalid")
	ErrJoiningCasePartnerAccess        = errors.New("partner does not own this joining case")
	ErrJoiningCaseInvalidState         = errors.New("joining case queue state is invalid")
	ErrJoiningCaseInvalidCursor        = errors.New("joining case queue cursor is invalid")
	ErrJoiningCaseInvalidLimit         = errors.New("joining case queue limit is invalid")
	ErrJoiningCaseInvalidSort          = errors.New("joining case queue sort is invalid")
	ErrJoiningCaseInvalidSearch        = errors.New("joining case queue search is invalid")
	ErrJoiningCaseServiceCity          = errors.New("joining case requires an active service city")
	ErrJoiningCaseStoreOrigin          = errors.New("joining case requires a fixed store origin")
	ErrFinancialProfileBindingNotFound = errors.New("joining case financial profile binding was not found")
)

type JoiningCaseRecord struct {
	ID                           string
	ContactPhoneE164             string
	OwnerFullName                string
	BusinessName                 string
	FirstStoreName               string
	WalletProviderKey            string
	FirstStoreAddress            string
	FirstStoreWorkingHours       json.RawMessage
	FirstStoreProofType          string
	FirstStoreProofNumberPresent bool
	FirstStoreProofImageUploaded bool
	FirstStoreNotes              string
	FirstStoreServiceCityID      string
	FirstStoreVerticalID         string
	FirstStoreCommercialTypeID   string
	FirstStoreLatitude           *float64
	FirstStoreLongitude          *float64
	FirstStoreFulfillmentModes   []string
	PartnerActorID               string
	OriginatingFieldActorID      string
	Origin                       string
	State                        string
	SettlementPeriod             string
	TermsPolicyVersion           string
	FinancialProfileID           string
	FinancialProfileState        string
	CorrectionReason             string
	ReviewedBy                   string
	StoreID                      string
	StoreProfileImage            *StoreProfileMediaRecord
	Store                        *StoreRecord
	Version                      int
	CreatedAt                    time.Time
	UpdatedAt                    time.Time
}

type PendingFinancialProfileBinding struct {
	ID                 string
	CaseID             string
	IdempotencyKey     string
	RequestHash        string
	CorrelationID      string
	ActingActorID      string
	PartnerActorID     string
	Origin             string
	SettlementPeriod   string
	TermsPolicyVersion string
	FinancialProfileID string
	Attempts           int
}

type JoiningCaseResult struct {
	Case     JoiningCaseRecord
	Replayed bool
}

type JoiningCaseListResult struct {
	Cases      []JoiningCaseRecord
	NextCursor string
}

type JoiningCaseRequest struct {
	Phone, BusinessName, FirstStoreName         string
	OwnerFullName, FirstStoreAddress            string
	FirstStoreWorkingHours                      json.RawMessage
	FirstStoreProofType, FirstStoreProofNumber  string
	FirstStoreNotes                             string
	WalletProviderKey                           string
	ServiceCityID, VerticalID, CommercialTypeID string
	Latitude, Longitude                         float64
	FulfillmentModes                            []string
}

type CreateJoiningCaseInput struct {
	IdempotencyKey, RequestHash, ActingActorID, CorrelationID string
	Origin, OriginatingFieldActorID                           string
	EvidenceKeyring                                           *JoiningCaseEvidenceKeyring
	Request                                                   JoiningCaseRequest
}

type CorrectJoiningCaseInput struct {
	CaseID, ActorID, BusinessName, FirstStoreName string
	OwnerFullName, FirstStoreAddress              string
	FirstStoreWorkingHours                        json.RawMessage
	FirstStoreProofType, FirstStoreProofNumber    string
	FirstStoreNotes                               string
	EvidenceKeyring                               *JoiningCaseEvidenceKeyring
	ExpectedVersion                               int
	IdempotencyKey, RequestHash, CorrelationID    string
	ServiceCityID, VerticalID, CommercialTypeID   string
	Latitude, Longitude                           float64
	FulfillmentModes                              []string
}

type UpdateFieldJoiningCaseDraftInput struct {
	CaseID, FieldActorID, IdempotencyKey, RequestHash, CorrelationID string
	ExpectedVersion                                                  int
	EvidenceKeyring                                                  *JoiningCaseEvidenceKeyring
	PreserveProofNumber                                              bool
	Request                                                          JoiningCaseRequest
}

type ReviewJoiningCaseInput struct {
	CaseID, Decision, CorrectionReason                        string
	SettlementPeriod, TermsPolicyVersion                      string
	ExpectedVersion                                           int
	IdempotencyKey, RequestHash, ActingActorID, CorrelationID string
}

type BindJoiningCaseFinancialTermsInput struct {
	CaseID, SettlementPeriod, TermsPolicyVersion              string
	ExpectedVersion                                           int
	IdempotencyKey, RequestHash, ActingActorID, CorrelationID string
}

func HashJoiningCaseRequest(input JoiningCaseRequest) string {
	return hashFacts(input.Phone, input.OwnerFullName, input.BusinessName, input.FirstStoreName, input.WalletProviderKey, input.FirstStoreAddress, string(input.FirstStoreWorkingHours), input.FirstStoreProofType, input.FirstStoreProofNumber, input.FirstStoreNotes, input.ServiceCityID, input.VerticalID, input.CommercialTypeID, formatCoordinate(input.Latitude), formatCoordinate(input.Longitude), strings.Join(input.FulfillmentModes, ","))
}

func HashJoiningCaseSubmit(caseID, actorID string, expectedVersion int) string {
	return hashFacts(caseID, actorID, strconv.Itoa(expectedVersion))
}

func ValidateStoreWorkingHours(value json.RawMessage) bool {
	var schedule struct {
		Intervals []struct {
			DayOfWeek     int    `json:"dayOfWeek"`
			OpensAt       string `json:"opensAt"`
			ClosesAt      string `json:"closesAt"`
			ClosesNextDay bool   `json:"closesNextDay"`
		} `json:"intervals"`
	}
	if len(value) == 0 || json.Unmarshal(value, &schedule) != nil || len(schedule.Intervals) == 0 || len(schedule.Intervals) > 28 {
		return false
	}
	const weekMinutes = 7 * 24 * 60
	type segment struct{ start, end int }
	segments := make([]segment, 0, len(schedule.Intervals)*2)
	for _, interval := range schedule.Intervals {
		if interval.DayOfWeek < 1 || interval.DayOfWeek > 7 {
			return false
		}
		open, openErr := time.Parse("15:04", interval.OpensAt)
		closeAt, closeErr := time.Parse("15:04", interval.ClosesAt)
		if openErr != nil || closeErr != nil {
			return false
		}
		startMinute := open.Hour()*60 + open.Minute()
		endMinute := closeAt.Hour()*60 + closeAt.Minute()
		if interval.ClosesNextDay {
			if endMinute > startMinute {
				return false
			}
			endMinute += 24 * 60
		} else if endMinute <= startMinute {
			return false
		}
		start := (interval.DayOfWeek-1)*24*60 + startMinute
		end := (interval.DayOfWeek-1)*24*60 + endMinute
		pieces := []segment{{start: start, end: min(end, weekMinutes)}}
		if end > weekMinutes {
			pieces = append(pieces, segment{start: 0, end: end - weekMinutes})
		}
		for _, piece := range pieces {
			for _, previous := range segments {
				if piece.start < previous.end && previous.start < piece.end {
					return false
				}
			}
			segments = append(segments, piece)
		}
	}
	return true
}

func HashFieldJoiningCaseAdmission(caseID, fieldActorID string, expectedVersion int) string {
	return hashFacts("field-admission-request", caseID, fieldActorID, strconv.Itoa(expectedVersion))
}

func HashJoiningCaseCorrectAndResubmit(input CorrectJoiningCaseInput) string {
	return hashFacts("correct-and-resubmit", input.CaseID, input.ActorID, input.OwnerFullName, input.BusinessName, input.FirstStoreName, input.FirstStoreAddress, string(input.FirstStoreWorkingHours), input.FirstStoreProofType, input.FirstStoreProofNumber, input.FirstStoreNotes, strconv.Itoa(input.ExpectedVersion), input.ServiceCityID, input.VerticalID, input.CommercialTypeID, formatCoordinate(input.Latitude), formatCoordinate(input.Longitude))
}

func HashJoiningCaseReview(caseID, decision, correctionReason string, expectedVersion int) string {
	return hashFacts(caseID, decision, correctionReason, strconv.Itoa(expectedVersion))
}

func HashJoiningCaseReviewWithFinancialTerms(caseID, decision, correctionReason string, expectedVersion int, settlementPeriod, termsPolicyVersion string) string {
	return hashFacts(caseID, decision, correctionReason, strconv.Itoa(expectedVersion), strings.TrimSpace(settlementPeriod), strings.TrimSpace(termsPolicyVersion))
}

func CreateJoiningCase(ctx context.Context, db *sql.DB, input CreateJoiningCaseInput) (JoiningCaseResult, error) {
	input.Origin = "control_panel"
	input.OriginatingFieldActorID = ""
	return createJoiningCase(ctx, db, input)
}

func CreateJoiningCaseForField(ctx context.Context, db *sql.DB, input CreateJoiningCaseInput) (JoiningCaseResult, error) {
	input.Origin = "field"
	input.OriginatingFieldActorID = input.ActingActorID
	return createJoiningCase(ctx, db, input)
}

func CreateFieldJoiningCaseDraft(ctx context.Context, db *sql.DB, input CreateJoiningCaseInput) (JoiningCaseResult, error) {
	input.Origin = "field"
	input.OriginatingFieldActorID = strings.TrimSpace(input.ActingActorID)
	return createFieldJoiningCaseDraft(ctx, db, input)
}

func createFieldJoiningCaseDraft(ctx context.Context, db *sql.DB, input CreateJoiningCaseInput) (JoiningCaseResult, error) {
	request := input.Request
	input.OriginatingFieldActorID = strings.TrimSpace(input.OriginatingFieldActorID)
	if db == nil || input.OriginatingFieldActorID == "" || strings.TrimSpace(input.ActingActorID) != input.OriginatingFieldActorID || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.RequestHash) < 1 || len(input.RequestHash) > 128 || len(strings.TrimSpace(input.CorrelationID)) < 8 || len(strings.TrimSpace(input.CorrelationID)) > 128 || request.Phone == "" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin Field joining-case draft: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, input.IdempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	var storedHash, storedCaseID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,case_id,operation FROM dsh.joining_case_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, input.IdempotencyKey).Scan(&storedHash, &storedCaseID, &operation)
	if err == nil {
		if storedHash != input.RequestHash || operation != "create" {
			return JoiningCaseResult{}, ErrJoiningCaseIdempotency
		}
		result, readErr := readJoiningCaseTx(ctx, tx, storedCaseID)
		if readErr != nil {
			return JoiningCaseResult{}, readErr
		}
		if result.Case.OriginatingFieldActorID != input.OriginatingFieldActorID {
			return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
		}
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, fmt.Errorf("read joining-case draft idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:joining-case:phone:"+request.Phone); err != nil {
		return JoiningCaseResult{}, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT id FROM dsh.joining_cases WHERE contact_phone_e164=$1 AND state <> 'approved'`, request.Phone).Scan(&existing)
	if err == nil {
		return JoiningCaseResult{}, ErrJoiningCaseExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, err
	}
	caseID, err := newID("join")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if strings.TrimSpace(request.FirstStoreProofNumber) != "" && input.EvidenceKeyring == nil {
		return JoiningCaseResult{}, errors.New("DSH joining-case evidence keyring is required")
	}
	var latitude, longitude any
	if request.Latitude != 0 || request.Longitude != 0 {
		latitude, longitude = request.Latitude, request.Longitude
	}
	workingHours := any(nil)
	if len(request.FirstStoreWorkingHours) > 0 {
		workingHours = string(request.FirstStoreWorkingHours)
	}
	var modes any = pq.Array(request.FulfillmentModes)
	if request.FulfillmentModes == nil {
		modes = pq.Array([]string{})
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,owner_full_name,business_name,first_store_name,first_store_address,first_store_working_hours,first_store_proof_type,first_store_notes,first_store_service_city_id,first_store_vertical_id,first_store_commercial_type_id,first_store_latitude,first_store_longitude,first_store_fulfillment_modes,originating_field_actor_id,origin,wallet_provider_key) VALUES($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,''),$7::jsonb,NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),$13,$14,$15,$16,'field',NULLIF($17,''))`, caseID, request.Phone, request.OwnerFullName, request.BusinessName, request.FirstStoreName, request.FirstStoreAddress, workingHours, request.FirstStoreProofType, request.FirstStoreNotes, request.ServiceCityID, request.VerticalID, request.CommercialTypeID, latitude, longitude, modes, input.OriginatingFieldActorID, request.WalletProviderKey)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("create Field joining-case draft: %w", err)
	}
	if strings.TrimSpace(request.FirstStoreProofNumber) != "" {
		keyID, ciphertext, encryptErr := input.EvidenceKeyring.Encrypt(caseID, "proof-number", []byte(strings.TrimSpace(request.FirstStoreProofNumber)))
		if encryptErr != nil {
			return JoiningCaseResult{}, encryptErr
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence(joining_case_id,proof_number_key_id,proof_number_ciphertext) VALUES($1,$2,$3)`, caseID, keyID, ciphertext); err != nil {
			return JoiningCaseResult{}, fmt.Errorf("store encrypted Field draft proof number: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_mutation_idempotency(idempotency_key,request_hash,case_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'draft')`, input.IdempotencyKey, input.RequestHash, caseID); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_created", input.IdempotencyKey, input.CorrelationID, input.ActingActorID, caseID, "", "draft", 1, input.RequestHash, "", "", ""); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err := ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

func UpdateFieldJoiningCaseDraft(ctx context.Context, db *sql.DB, input UpdateFieldJoiningCaseDraftInput) (JoiningCaseResult, error) {
	input.CaseID, input.FieldActorID = strings.TrimSpace(input.CaseID), strings.TrimSpace(input.FieldActorID)
	if db == nil || input.CaseID == "" || input.FieldActorID == "" || input.ExpectedVersion < 1 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 || input.RequestHash == "" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin Field joining-case draft update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, input.IdempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, input.IdempotencyKey, input.RequestHash, input.CaseID, "draft_update")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if found {
		if result.Case.OriginatingFieldActorID != input.FieldActorID {
			return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
		}
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	current, err := readJoiningCaseTx(ctx, tx, input.CaseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if current.Case.Origin != "field" || current.Case.OriginatingFieldActorID != input.FieldActorID {
		return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
	}
	if current.Case.State != "draft" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if current.Case.Version != input.ExpectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	request := input.Request
	// An uploaded proof image is tied to the proof details it accompanied.
	// Changing either detail requires a newly uploaded image before submission.
	proofDetailsChanged := current.Case.FirstStoreProofType != request.FirstStoreProofType ||
		(!input.PreserveProofNumber && strings.TrimSpace(request.FirstStoreProofNumber) != "")
	if request.Phone != current.Case.ContactPhoneE164 {
		phones := []string{current.Case.ContactPhoneE164, request.Phone}
		sort.Strings(phones)
		for _, phone := range phones {
			if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:joining-case:phone:"+phone); err != nil {
				return JoiningCaseResult{}, err
			}
		}
		var exists string
		err := tx.QueryRowContext(ctx, `SELECT id FROM dsh.joining_cases WHERE contact_phone_e164=$1 AND id<>$2 AND state <> 'approved'`, request.Phone, input.CaseID).Scan(&exists)
		if err == nil {
			return JoiningCaseResult{}, ErrJoiningCaseExists
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, err
		}
	}
	var latitude, longitude any
	if request.Latitude != 0 || request.Longitude != 0 {
		latitude, longitude = request.Latitude, request.Longitude
	}
	workingHours := any(nil)
	if len(request.FirstStoreWorkingHours) > 0 {
		workingHours = string(request.FirstStoreWorkingHours)
	}
	var modes any = pq.Array(request.FulfillmentModes)
	if request.FulfillmentModes == nil {
		modes = pq.Array([]string{})
	}
	updated, err := tx.ExecContext(ctx, `UPDATE dsh.joining_cases SET contact_phone_e164=$2,owner_full_name=NULLIF($3,''),business_name=$4,first_store_name=$5,wallet_provider_key=NULLIF($6,''),first_store_address=NULLIF($7,''),first_store_working_hours=$8::jsonb,first_store_proof_type=NULLIF($9,''),first_store_notes=NULLIF($10,''),first_store_service_city_id=NULLIF($11,''),first_store_vertical_id=NULLIF($12,''),first_store_commercial_type_id=NULLIF($13,''),first_store_latitude=$14,first_store_longitude=$15,first_store_fulfillment_modes=$16,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND originating_field_actor_id=$17 AND origin='field' AND state='draft' AND version=$18`, input.CaseID, request.Phone, request.OwnerFullName, request.BusinessName, request.FirstStoreName, request.WalletProviderKey, request.FirstStoreAddress, workingHours, request.FirstStoreProofType, request.FirstStoreNotes, request.ServiceCityID, request.VerticalID, request.CommercialTypeID, latitude, longitude, modes, input.FieldActorID, input.ExpectedVersion)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("update Field joining-case draft: %w", err)
	}
	if count, err := updated.RowsAffected(); err != nil || count != 1 {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if !input.PreserveProofNumber && strings.TrimSpace(request.FirstStoreProofNumber) != "" {
		if input.EvidenceKeyring == nil {
			return JoiningCaseResult{}, errors.New("DSH joining-case evidence keyring is required")
		}
		keyID, ciphertext, encryptErr := input.EvidenceKeyring.Encrypt(input.CaseID, "proof-number", []byte(strings.TrimSpace(request.FirstStoreProofNumber)))
		if encryptErr != nil {
			return JoiningCaseResult{}, encryptErr
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence(joining_case_id,proof_number_key_id,proof_number_ciphertext) VALUES($1,$2,$3) ON CONFLICT(joining_case_id) DO UPDATE SET proof_number_key_id=EXCLUDED.proof_number_key_id,proof_number_ciphertext=EXCLUDED.proof_number_ciphertext,updated_at=clock_timestamp()`, input.CaseID, keyID, ciphertext)
		if err != nil {
			return JoiningCaseResult{}, fmt.Errorf("update encrypted Field draft proof number: %w", err)
		}
	}
	if proofDetailsChanged && current.Case.FirstStoreProofImageUploaded {
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_case_private_evidence SET proof_image_key_id=NULL, proof_image_ciphertext=NULL, proof_image_content_type=NULL, proof_image_ciphertext_sha256=NULL, proof_image_byte_size=NULL, proof_image_uploaded_at=NULL, updated_at=clock_timestamp() WHERE joining_case_id=$1`, input.CaseID); err != nil {
			return JoiningCaseResult{}, fmt.Errorf("invalidate outdated Field joining-case proof image: %w", err)
		}
	}
	resultVersion := input.ExpectedVersion + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_mutation_idempotency(idempotency_key,request_hash,case_id,operation,result_version,result_state) VALUES($1,$2,$3,'draft_update',$4,'draft')`, input.IdempotencyKey, input.RequestHash, input.CaseID, resultVersion); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_draft_updated", input.IdempotencyKey, input.CorrelationID, input.FieldActorID, input.CaseID, "draft", "draft", resultVersion, input.RequestHash, "", "", ""); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, input.CaseID)
	result.Replayed = false
	return result, err
}

func createJoiningCase(ctx context.Context, db *sql.DB, input CreateJoiningCaseInput) (JoiningCaseResult, error) {
	idempotencyKey := input.IdempotencyKey
	requestHash := input.RequestHash
	actingActorID := input.ActingActorID
	correlationID := input.CorrelationID
	origin := input.Origin
	originatingFieldActorID := input.OriginatingFieldActorID
	phone := input.Request.Phone
	businessName := input.Request.BusinessName
	firstStoreName := input.Request.FirstStoreName
	serviceCityID := input.Request.ServiceCityID
	verticalID := input.Request.VerticalID
	commercialTypeID := input.Request.CommercialTypeID
	latitude := input.Request.Latitude
	longitude := input.Request.Longitude
	fulfillmentModes := input.Request.FulfillmentModes
	if db == nil {
		return JoiningCaseResult{}, errors.New("DSH database is nil")
	}
	if origin != "field" && origin != "control_panel" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if origin == "field" && strings.TrimSpace(originatingFieldActorID) == "" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if len(fulfillmentModes) == 0 {
		return JoiningCaseResult{}, ErrFulfillmentModesInvalid
	}
	serviceCityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	commercialTypeID = strings.TrimSpace(commercialTypeID)
	if serviceCityID == "" {
		return JoiningCaseResult{}, ErrJoiningCaseServiceCity
	}
	if verticalID == "" {
		return JoiningCaseResult{}, ErrCatalogVerticalNotFound
	}
	if commercialTypeID == "" {
		return JoiningCaseResult{}, ErrCommercialStoreTypeNotFound
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
	if err := requireActiveJoiningCaseOptionsTx(ctx, tx, serviceCityID, verticalID, commercialTypeID); err != nil {
		return JoiningCaseResult{}, err
	}
	fulfillmentModes, err = NormalizeStoreFulfillmentModes(fulfillmentModes)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	latitude, longitude, err = normalizeLocation(latitude, longitude)
	if err != nil {
		return JoiningCaseResult{}, ErrJoiningCaseStoreOrigin
	}
	caseID, err := newID("join")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if strings.TrimSpace(input.Request.FirstStoreProofNumber) != "" && input.EvidenceKeyring == nil {
		return JoiningCaseResult{}, errors.New("DSH joining-case evidence keyring is required")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,owner_full_name,business_name,first_store_name,first_store_address,first_store_working_hours,first_store_proof_type,first_store_notes,first_store_service_city_id,first_store_vertical_id,first_store_commercial_type_id,first_store_latitude,first_store_longitude,first_store_fulfillment_modes,originating_field_actor_id,origin,wallet_provider_key) VALUES($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,''),NULLIF($7,'')::jsonb,NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),NULLIF($11,''),$12,$13,$14,$15,NULLIF($16,''),$17,$18)`, caseID, phone, input.Request.OwnerFullName, businessName, firstStoreName, input.Request.FirstStoreAddress, string(input.Request.FirstStoreWorkingHours), input.Request.FirstStoreProofType, input.Request.FirstStoreNotes, serviceCityID, verticalID, commercialTypeID, latitude, longitude, pq.Array(fulfillmentModes), originatingFieldActorID, origin, input.Request.WalletProviderKey); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("create joining case: %w", err)
	}
	if strings.TrimSpace(input.Request.FirstStoreProofNumber) != "" {
		keyID, ciphertext, err := input.EvidenceKeyring.Encrypt(caseID, "proof-number", []byte(strings.TrimSpace(input.Request.FirstStoreProofNumber)))
		if err != nil {
			return JoiningCaseResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence(joining_case_id,proof_number_key_id,proof_number_ciphertext) VALUES($1,$2,$3)`, caseID, keyID, ciphertext); err != nil {
			return JoiningCaseResult{}, fmt.Errorf("store joining-case private proof number: %w", err)
		}
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
	if err := ValidateJoiningCaseSubmissionReadiness(current.Case, expectedVersion); err != nil {
		return JoiningCaseResult{}, err
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

func ValidateJoiningCaseSubmissionReadiness(current JoiningCaseRecord, expectedVersion int) error {
	if current.Version != expectedVersion {
		return ErrJoiningCaseVersion
	}
	canSubmit := (current.Origin == "control_panel" && current.State == "draft") || (current.Origin == "field" && current.State == "admission_requested")
	if !canSubmit {
		return ErrJoiningCaseState
	}
	return ValidateJoiningCaseIntakeReadiness(current)
}

func ValidateJoiningCaseIntakeReadiness(current JoiningCaseRecord) error {
	if _, validProvider := NormalizeWalletProviderKey(current.WalletProviderKey); strings.TrimSpace(current.OwnerFullName) == "" || strings.TrimSpace(current.BusinessName) == "" || strings.TrimSpace(current.FirstStoreName) == "" || !validProvider || strings.TrimSpace(current.FirstStoreAddress) == "" || !ValidateStoreWorkingHours(current.FirstStoreWorkingHours) || strings.TrimSpace(current.FirstStoreProofType) == "" || !current.FirstStoreProofNumberPresent || !current.FirstStoreProofImageUploaded || current.StoreProfileImage == nil {
		return ErrJoiningCaseState
	}
	if strings.TrimSpace(current.FirstStoreServiceCityID) == "" {
		return ErrJoiningCaseServiceCity
	}
	if strings.TrimSpace(current.FirstStoreVerticalID) == "" {
		return ErrCatalogVerticalNotFound
	}
	if strings.TrimSpace(current.FirstStoreCommercialTypeID) == "" {
		return ErrCommercialStoreTypeNotFound
	}
	if current.FirstStoreLatitude == nil || current.FirstStoreLongitude == nil {
		return ErrJoiningCaseStoreOrigin
	}
	if _, _, err := normalizeLocation(*current.FirstStoreLatitude, *current.FirstStoreLongitude); err != nil {
		return ErrJoiningCaseStoreOrigin
	}
	if len(current.FirstStoreFulfillmentModes) == 0 {
		return ErrJoiningCaseState
	}
	if _, err := NormalizeStoreFulfillmentModes(current.FirstStoreFulfillmentModes); err != nil {
		return ErrJoiningCaseState
	}
	return nil
}

func RequestFieldJoiningCaseAdmission(ctx context.Context, db *sql.DB, caseID, fieldActorID string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (JoiningCaseResult, error) {
	if db == nil || strings.TrimSpace(fieldActorID) == "" || expectedVersion < 1 {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin Field joining-case admission request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, requestHash, caseID, "field-admission-request")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if found {
		if result.Case.Origin != "field" || result.Case.OriginatingFieldActorID != strings.TrimSpace(fieldActorID) {
			return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
		}
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
	if current.Case.Origin != "field" || current.Case.OriginatingFieldActorID != strings.TrimSpace(fieldActorID) {
		return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
	}
	if current.Case.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	if current.Case.State != "draft" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	if err := ValidateJoiningCaseIntakeReadiness(current.Case); err != nil {
		return JoiningCaseResult{}, err
	}
	updated, err := updateJoiningCaseStateTx(ctx, tx, current.Case, "admission_requested", "", "", "", "", expectedVersion)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, requestHash, updated, "field-admission-request"); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_admission_requested", idempotencyKey, correlationID, fieldActorID, caseID, current.Case.State, updated.State, updated.Version, requestHash, "", "", ""); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

func CorrectAndResubmitJoiningCase(ctx context.Context, db *sql.DB, input CorrectJoiningCaseInput) (JoiningCaseResult, error) {
	return correctAndResubmitJoiningCase(ctx, db, input)
}

func correctAndResubmitJoiningCase(ctx context.Context, db *sql.DB, input CorrectJoiningCaseInput) (JoiningCaseResult, error) {
	caseID, actorID, businessName, firstStoreName := input.CaseID, input.ActorID, input.BusinessName, input.FirstStoreName
	expectedVersion := input.ExpectedVersion
	idempotencyKey, requestHash, correlationID := input.IdempotencyKey, input.RequestHash, input.CorrelationID
	serviceCityID, verticalID, commercialTypeID := input.ServiceCityID, input.VerticalID, input.CommercialTypeID
	latitude, longitude := input.Latitude, input.Longitude
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
	if !current.Case.FirstStoreProofImageUploaded {
		return JoiningCaseResult{}, ErrJoiningCaseProofImageRequired
	}
	var freshProofImage bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.joining_case_private_evidence_audit WHERE joining_case_id=$1 AND event_type='proof_image_uploaded' AND authority_source='partner' AND acting_actor_id=$2 AND result_version=$3)`, caseID, actorID, expectedVersion).Scan(&freshProofImage); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("verify fresh partner proof image for correction: %w", err)
	}
	if !freshProofImage {
		return JoiningCaseResult{}, ErrJoiningCaseProofImageRequired
	}
	if strings.TrimSpace(input.FirstStoreProofNumber) != "" && input.EvidenceKeyring == nil {
		return JoiningCaseResult{}, errors.New("DSH joining-case evidence keyring is required")
	}
	serviceCityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	commercialTypeID = strings.TrimSpace(commercialTypeID)
	if serviceCityID == "" {
		return JoiningCaseResult{}, ErrJoiningCaseServiceCity
	}
	if verticalID == "" {
		return JoiningCaseResult{}, ErrCatalogVerticalNotFound
	}
	if commercialTypeID == "" {
		return JoiningCaseResult{}, ErrCommercialStoreTypeNotFound
	}
	if err := requireActiveJoiningCaseOptionsTx(ctx, tx, serviceCityID, verticalID, commercialTypeID); err != nil {
		return JoiningCaseResult{}, err
	}
	latitude, longitude, err = normalizeLocation(latitude, longitude)
	if err != nil {
		return JoiningCaseResult{}, ErrJoiningCaseStoreOrigin
	}
	var updatedID string
	proofType := strings.TrimSpace(input.FirstStoreProofType)
	proofNumberKeyID := ""
	var proofNumberCiphertext []byte
	if strings.TrimSpace(input.FirstStoreProofNumber) != "" {
		proofNumberKeyID, proofNumberCiphertext, err = input.EvidenceKeyring.Encrypt(caseID, "proof-number", []byte(strings.TrimSpace(input.FirstStoreProofNumber)))
		if err != nil {
			return JoiningCaseResult{}, err
		}
	}
	query := `UPDATE dsh.joining_cases SET owner_full_name=NULLIF($2,''),business_name=$3,first_store_name=$4,first_store_address=NULLIF($5,''),first_store_working_hours=NULLIF($6,'')::jsonb,first_store_proof_type=NULLIF($7,''),first_store_notes=NULLIF($8,''),first_store_service_city_id=NULLIF($9,''),first_store_vertical_id=NULLIF($10,''),first_store_commercial_type_id=$11,first_store_latitude=$12,first_store_longitude=$13,first_store_fulfillment_modes=$14,state='submitted',correction_reason=NULL,reviewed_by=NULL,store_id=NULL,settlement_period=NULL,financial_profile_id=NULL,financial_profile_state='REQUIRED',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND partner_actor_id=$15 AND state='needs_correction' AND version=$16 RETURNING id`
	if err := tx.QueryRowContext(ctx, query, current.Case.ID, input.OwnerFullName, businessName, firstStoreName, input.FirstStoreAddress, string(input.FirstStoreWorkingHours), proofType, input.FirstStoreNotes, serviceCityID, verticalID, commercialTypeID, latitude, longitude, pq.Array(input.FulfillmentModes), actorID, expectedVersion).Scan(&updatedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, ErrJoiningCaseVersion
		}
		return JoiningCaseResult{}, fmt.Errorf("correct joining case: %w", err)
	}
	if strings.TrimSpace(input.FirstStoreProofNumber) != "" {
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence(joining_case_id,proof_number_key_id,proof_number_ciphertext) VALUES($1,$2,$3) ON CONFLICT(joining_case_id) DO UPDATE SET proof_number_key_id=EXCLUDED.proof_number_key_id,proof_number_ciphertext=EXCLUDED.proof_number_ciphertext,updated_at=clock_timestamp()`, caseID, proofNumberKeyID, proofNumberCiphertext); err != nil {
			return JoiningCaseResult{}, fmt.Errorf("update joining-case private proof number: %w", err)
		}
	}
	updated, err := readJoiningCaseTx(ctx, tx, updatedID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, requestHash, updated.Case, "correct_and_resubmit"); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_corrected_and_resubmitted", idempotencyKey, correlationID, actorID, caseID, current.Case.State, updated.Case.State, updated.Case.Version, requestHash, current.Case.PartnerActorID, "", current.Case.CorrectionReason); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

func requireActiveJoiningCaseOptionsTx(ctx context.Context, tx *sql.Tx, serviceCityID, verticalID, commercialTypeID string) error {
	var active bool
	err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.service_cities WHERE id=$1 FOR SHARE", strings.TrimSpace(serviceCityID)).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !active) {
		return ErrJoiningCaseServiceCity
	}
	if err != nil {
		return fmt.Errorf("read joining case service city: %w", err)
	}
	err = tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1 FOR SHARE", strings.TrimSpace(verticalID)).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !active) {
		return ErrCatalogVerticalNotFound
	}
	if err != nil {
		return fmt.Errorf("read joining case commerce vertical: %w", err)
	}
	err = tx.QueryRowContext(ctx, `SELECT type.active FROM dsh.commercial_store_types type JOIN dsh.commerce_verticals vertical ON vertical.id=type.vertical_id WHERE type.id=$1 AND type.vertical_id=$2 AND type.active=true AND vertical.active=true FOR SHARE OF type,vertical`, strings.TrimSpace(commercialTypeID), strings.TrimSpace(verticalID)).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !active) {
		return ErrCommercialStoreTypeNotFound
	}
	if err != nil {
		return fmt.Errorf("read joining case commercial store type: %w", err)
	}
	return nil
}

type joiningCaseCursor struct {
	Version      int       `json:"v"`
	Scope        string    `json:"scope"`
	CreatedAt    time.Time `json:"createdAt"`
	ID           string    `json:"id"`
	Sort         string    `json:"sort"`
	State        string    `json:"state"`
	Query        string    `json:"query"`
	FieldActorID string    `json:"fieldActorId"`
}

func encodeJoiningCaseCursor(cursor joiningCaseCursor) (string, error) {
	value, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func normalizeJoiningCaseSearch(queryText string) (string, error) {
	if !utf8.ValidString(queryText) {
		return "", ErrJoiningCaseInvalidSearch
	}
	queryText = strings.ToLower(strings.TrimSpace(queryText))
	if utf8.RuneCountInString(queryText) > 128 || strings.ContainsRune(queryText, '\x00') {
		return "", ErrJoiningCaseInvalidSearch
	}
	return queryText, nil
}

func decodeJoiningCaseCursor(raw, scope, state, query, sort, fieldActorID string) (*joiningCaseCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 2048 {
		return nil, ErrJoiningCaseInvalidCursor
	}
	value, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, ErrJoiningCaseInvalidCursor
	}
	var cursor joiningCaseCursor
	if json.Unmarshal(value, &cursor) != nil || cursor.Version != 1 || cursor.Scope != scope || cursor.State != state || cursor.Query != query || cursor.Sort != sort || cursor.FieldActorID != fieldActorID || cursor.ID == "" || cursor.CreatedAt.IsZero() {
		return nil, ErrJoiningCaseInvalidCursor
	}
	return &cursor, nil
}

func ListJoiningCases(ctx context.Context, db *sql.DB, state, queryText, sort string, limit int, cursor string) (JoiningCaseListResult, error) {
	if db == nil {
		return JoiningCaseListResult{}, errors.New("DSH database is nil")
	}
	if limit < 1 || limit > 50 {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidLimit
	}
	state = strings.TrimSpace(strings.ToLower(state))
	if state != "" && state != "draft" && state != "admission_requested" && state != "submitted" && state != "needs_correction" && state != "approved" {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidState
	}
	sort = strings.TrimSpace(strings.ToLower(sort))
	if sort == "" {
		sort = "created_asc"
	}
	if sort != "created_asc" && sort != "created_desc" {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidSort
	}
	queryText, err := normalizeJoiningCaseSearch(queryText)
	if err != nil {
		return JoiningCaseListResult{}, err
	}
	decoded, err := decodeJoiningCaseCursor(cursor, "operator", state, queryText, sort, "")
	if err != nil {
		return JoiningCaseListResult{}, err
	}

	query := `SELECT c.id,c.contact_phone_e164,c.business_name,c.first_store_name,c.partner_actor_id,c.originating_field_actor_id,c.origin,c.state,c.correction_reason,c.reviewed_by,c.version,c.created_at,c.updated_at,c.first_store_service_city_id,c.first_store_vertical_id,c.first_store_commercial_type_id,c.first_store_latitude,c.first_store_longitude,COALESCE(c.wallet_provider_key,'') FROM dsh.joining_cases c WHERE 1=1`
	args := make([]any, 0, 5)
	if state != "" {
		args = append(args, state)
		query += fmt.Sprintf(" AND c.state=$%d", len(args))
	}
	if queryText != "" {
		args = append(args, queryText)
		searchArg := len(args)
		query += fmt.Sprintf(" AND (position($%d in lower(c.id::text))>0 OR position($%d in lower(c.contact_phone_e164))>0 OR position($%d in lower(c.owner_full_name))>0 OR position($%d in lower(c.business_name))>0 OR position($%d in lower(c.first_store_name))>0)", searchArg, searchArg, searchArg, searchArg, searchArg)
	}
	if decoded != nil {
		args = append(args, decoded.CreatedAt, decoded.ID)
		comparison := ">"
		if sort == "created_desc" {
			comparison = "<"
		}
		query += fmt.Sprintf(" AND (c.created_at,c.id)%s($%d,$%d)", comparison, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	order := "ASC"
	if sort == "created_desc" {
		order = "DESC"
	}
	query += fmt.Sprintf(" ORDER BY c.created_at %s,c.id %s LIMIT $%d", order, order, len(args))
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("list joining cases: %w", err)
	}
	defer rows.Close()
	items := make([]JoiningCaseRecord, 0, limit)
	for rows.Next() {
		var record JoiningCaseRecord
		var actorID, originActorID, origin, correctionReason, reviewedBy, cityID, verticalID, commercialTypeID sql.NullString
		var latitude, longitude sql.NullFloat64
		if err := rows.Scan(&record.ID, &record.ContactPhoneE164, &record.BusinessName, &record.FirstStoreName, &actorID, &originActorID, &origin, &record.State, &correctionReason, &reviewedBy, &record.Version, &record.CreatedAt, &record.UpdatedAt, &cityID, &verticalID, &commercialTypeID, &latitude, &longitude, &record.WalletProviderKey); err != nil {
			return JoiningCaseListResult{}, fmt.Errorf("scan joining case queue: %w", err)
		}
		if actorID.Valid {
			record.PartnerActorID = actorID.String
		}
		if originActorID.Valid {
			record.OriginatingFieldActorID = originActorID.String
		}
		if origin.Valid {
			record.Origin = origin.String
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
		if commercialTypeID.Valid {
			record.FirstStoreCommercialTypeID = commercialTypeID.String
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
		encoded, err := encodeJoiningCaseCursor(joiningCaseCursor{Version: 1, Scope: "operator", CreatedAt: last.CreatedAt, ID: last.ID, Sort: sort, State: state, Query: queryText})
		if err != nil {
			return JoiningCaseListResult{}, err
		}
		result.NextCursor = encoded
	}
	return result, nil
}

func ReviewJoiningCase(ctx context.Context, db *sql.DB, input ReviewJoiningCaseInput) (JoiningCaseResult, error) {
	caseID := input.CaseID
	idempotencyKey, requestHash := input.IdempotencyKey, input.RequestHash
	actingActorID, correlationID := input.ActingActorID, input.CorrelationID
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
	input, err = validateJoiningCaseReview(current.Case, input)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	decision, correctionReason := input.Decision, input.CorrectionReason
	settlementPeriod, termsPolicyVersion := input.SettlementPeriod, input.TermsPolicyVersion
	storeID := ""
	if decision == "approved" {
		storeID, err = createJoiningCaseReviewStoreTx(ctx, tx, current.Case, caseID)
		if err != nil {
			return JoiningCaseResult{}, err
		}
	}
	state := decision
	updated, err := updateJoiningCaseReviewStateTx(ctx, tx, updateJoiningCaseReviewStateInput{Current: current.Case, State: state, ActorID: current.Case.PartnerActorID, ReviewedBy: actingActorID, CorrectionReason: correctionReason, StoreID: storeID, SettlementPeriod: settlementPeriod, TermsPolicyVersion: termsPolicyVersion, ExpectedVersion: input.ExpectedVersion})
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
	if decision == "approved" {
		outboxID, outboxErr := newID("joining_financial")
		if outboxErr != nil {
			return JoiningCaseResult{}, outboxErr
		}
		if _, outboxErr = tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_financial_profile_outbox(id,case_id,idempotency_key,request_hash,correlation_id,acting_actor_id,partner_actor_id,origin,settlement_period,terms_policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, outboxID, caseID, idempotencyKey, requestHash, correlationID, actingActorID, current.Case.PartnerActorID, current.Case.Origin, settlementPeriod, termsPolicyVersion); outboxErr != nil {
			return JoiningCaseResult{}, outboxErr
		}
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, caseID)
	result.Replayed = false
	return result, err
}

func validateJoiningCaseReview(current JoiningCaseRecord, input ReviewJoiningCaseInput) (ReviewJoiningCaseInput, error) {
	if current.Version != input.ExpectedVersion {
		return input, ErrJoiningCaseVersion
	}
	if current.State != "submitted" || current.PartnerActorID == "" {
		return input, ErrJoiningCaseState
	}
	if err := ValidateJoiningCaseIntakeReadiness(current); err != nil {
		return input, err
	}
	if strings.TrimSpace(input.ActingActorID) == current.PartnerActorID {
		return input, ErrJoiningCaseSelfReview
	}
	input.Decision = strings.ToLower(strings.TrimSpace(input.Decision))
	if input.Decision != "approved" && input.Decision != "needs_correction" {
		return input, ErrJoiningCaseInvalidDecision
	}
	input.CorrectionReason = strings.TrimSpace(input.CorrectionReason)
	input.SettlementPeriod = strings.ToUpper(strings.TrimSpace(input.SettlementPeriod))
	if input.Decision == "approved" && ((input.SettlementPeriod != "DAILY" && input.SettlementPeriod != "WEEKLY" && input.SettlementPeriod != "MONTHLY") || !strings.HasPrefix(strings.TrimSpace(input.TermsPolicyVersion), "partner-financial-terms:v")) {
		return input, ErrJoiningCaseState
	}
	return input, nil
}

func createJoiningCaseReviewStoreTx(ctx context.Context, tx *sql.Tx, current JoiningCaseRecord, caseID string) (string, error) {
	if current.FirstStoreCommercialTypeID == "" {
		return "", ErrCommercialStoreTypeNotFound
	}
	if err := requireActiveJoiningCaseOptionsTx(ctx, tx, current.FirstStoreServiceCityID, current.FirstStoreVerticalID, current.FirstStoreCommercialTypeID); err != nil {
		return "", err
	}
	var existingStore string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE partner_actor_id=$1 ORDER BY created_at ASC LIMIT 1", current.PartnerActorID).Scan(&existingStore); err == nil {
		return "", ErrJoiningCaseStoreExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	storeID, err := newID("store")
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,address_text,business_working_hours,delivery_origin_latitude,delivery_origin_longitude,delivery_origin_version,delivery_origin_updated_at,fulfillment_modes) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,'')::jsonb,$9,$10,1,clock_timestamp(),$11)", storeID, current.PartnerActorID, current.FirstStoreName, current.FirstStoreServiceCityID, current.FirstStoreVerticalID, current.FirstStoreCommercialTypeID, current.FirstStoreAddress, string(current.FirstStoreWorkingHours), *current.FirstStoreLatitude, *current.FirstStoreLongitude, pq.Array(current.FirstStoreFulfillmentModes)); err != nil {
		return "", fmt.Errorf("create canonical store: %w", err)
	}
	if err := AttachStoreProfileMediaToStoreTx(ctx, tx, caseID, storeID); err != nil {
		return "", fmt.Errorf("attach canonical store profile image: %w", err)
	}
	return storeID, nil
}

func BindApprovedJoiningCaseFinancialTerms(ctx context.Context, db *sql.DB, input BindJoiningCaseFinancialTermsInput) (JoiningCaseResult, error) {
	caseID, settlementPeriod, termsPolicyVersion := input.CaseID, input.SettlementPeriod, input.TermsPolicyVersion
	expectedVersion := input.ExpectedVersion
	idempotencyKey, requestHash := input.IdempotencyKey, input.RequestHash
	actingActorID, correlationID := input.ActingActorID, input.CorrelationID
	if db == nil || (settlementPeriod != "DAILY" && settlementPeriod != "WEEKLY" && settlementPeriod != "MONTHLY") || !strings.HasPrefix(strings.TrimSpace(termsPolicyVersion), "partner-financial-terms:v") || expectedVersion < 1 {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin joining case financial terms binding: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, requestHash, caseID, "bind-financial-terms")
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
	if current.Case.State != "approved" || current.Case.FinancialProfileState != "REQUIRED" || current.Case.PartnerActorID == "" || current.Case.StoreID == "" || current.Case.SettlementPeriod != "" {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	updatedID := ""
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.joining_cases SET settlement_period=$2,terms_policy_version=$3,financial_profile_state='PENDING_BINDING',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$4 AND state='approved' AND financial_profile_state='REQUIRED' RETURNING id`, current.Case.ID, settlementPeriod, termsPolicyVersion, expectedVersion).Scan(&updatedID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoiningCaseResult{}, ErrJoiningCaseVersion
		}
		return JoiningCaseResult{}, err
	}
	updated, err := readJoiningCaseTx(ctx, tx, updatedID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, requestHash, updated.Case, "bind-financial-terms"); err != nil {
		return JoiningCaseResult{}, err
	}
	outboxID, err := newID("joining_financial")
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_financial_profile_outbox(id,case_id,idempotency_key,request_hash,correlation_id,acting_actor_id,partner_actor_id,origin,settlement_period,terms_policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, outboxID, current.Case.ID, idempotencyKey, requestHash, correlationID, actingActorID, current.Case.PartnerActorID, current.Case.Origin, settlementPeriod, termsPolicyVersion); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := auditJoiningCaseTx(ctx, tx, "joining_case_financial_terms_bound", idempotencyKey, correlationID, actingActorID, current.Case.ID, current.Case.State, updated.Case.State, updated.Case.Version, requestHash, current.Case.PartnerActorID, current.Case.StoreID, ""); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	result, err = ReadJoiningCase(ctx, db, current.Case.ID)
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
	caseRecord.StoreProfileImage, err = readStoreProfileMediaWithQuery(ctx, db, caseRecord.ID, caseRecord.StoreID)
	if err != nil {
		return JoiningCaseResult{}, err
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
	caseRecord.StoreProfileImage, err = readStoreProfileMediaWithQuery(ctx, db, caseRecord.ID, caseRecord.StoreID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	return JoiningCaseResult{Case: caseRecord}, nil
}

func LockPartnerJoiningCase(ctx context.Context, db *sql.DB, actorID string) (*sql.Tx, string, int, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return nil, "", 0, ErrJoiningCaseNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", 0, err
	}
	var state string
	var version int
	err = tx.QueryRowContext(ctx, "SELECT state,version FROM dsh.joining_cases WHERE partner_actor_id=$1 FOR UPDATE", actorID).Scan(&state, &version)
	if errors.Is(err, sql.ErrNoRows) {
		_ = tx.Rollback()
		return nil, "", 0, ErrJoiningCaseNotFound
	}
	if err != nil {
		_ = tx.Rollback()
		return nil, "", 0, err
	}
	return tx, state, version, nil
}

func ReadJoiningCaseForField(ctx context.Context, db *sql.DB, fieldActorID, caseID string) (JoiningCaseResult, error) {
	caseRecord, err := readJoiningCaseRow(ctx, db.QueryRowContext(ctx, joiningCaseSelect+" WHERE c.originating_field_actor_id=$1 AND c.id=$2", strings.TrimSpace(fieldActorID), strings.TrimSpace(caseID)), false)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, ErrJoiningCaseNotFound
	}
	if err != nil {
		return JoiningCaseResult{}, err
	}
	caseRecord.StoreProfileImage, err = readStoreProfileMediaWithQuery(ctx, db, caseRecord.ID, caseRecord.StoreID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	return JoiningCaseResult{Case: caseRecord}, nil
}

func ListJoiningCasesForField(ctx context.Context, db *sql.DB, fieldActorID, queryText string, limit int, cursor string) (JoiningCaseListResult, error) {
	fieldActorID = strings.TrimSpace(fieldActorID)
	if db == nil || fieldActorID == "" || len(fieldActorID) > 128 || limit < 1 || limit > 50 {
		return JoiningCaseListResult{}, ErrJoiningCaseInvalidLimit
	}
	queryText, err := normalizeJoiningCaseSearch(queryText)
	if err != nil {
		return JoiningCaseListResult{}, err
	}
	decoded, err := decodeJoiningCaseCursor(cursor, "field", "", queryText, "created_desc", fieldActorID)
	if err != nil {
		return JoiningCaseListResult{}, err
	}
	query := `SELECT c.id,c.contact_phone_e164,c.business_name,c.first_store_name,c.partner_actor_id,c.originating_field_actor_id,c.origin,c.state,c.correction_reason,c.reviewed_by,c.version,c.created_at,c.updated_at,c.first_store_service_city_id,c.first_store_vertical_id,c.first_store_commercial_type_id,c.first_store_latitude,c.first_store_longitude,COALESCE(c.wallet_provider_key,'') FROM dsh.joining_cases c WHERE c.originating_field_actor_id=$1`
	args := []any{fieldActorID}
	if queryText != "" {
		args = append(args, queryText)
		searchArg := len(args)
		query += fmt.Sprintf(" AND (position($%d in lower(c.id::text))>0 OR position($%d in lower(c.contact_phone_e164))>0 OR position($%d in lower(c.owner_full_name))>0 OR position($%d in lower(c.business_name))>0 OR position($%d in lower(c.first_store_name))>0)", searchArg, searchArg, searchArg, searchArg, searchArg)
	}
	if decoded != nil {
		args = append(args, decoded.CreatedAt, decoded.ID)
		query += fmt.Sprintf(" AND (c.created_at,c.id)<($%d,$%d)", len(args)-1, len(args))
	}
	args = append(args, limit+1)
	query += fmt.Sprintf(" ORDER BY c.created_at DESC,c.id DESC LIMIT $%d", len(args))
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("list Field joining cases: %w", err)
	}
	defer rows.Close()
	items := make([]JoiningCaseRecord, 0, limit+1)
	for rows.Next() {
		var record JoiningCaseRecord
		var actorID, originActorID, origin, correctionReason, reviewedBy, cityID, verticalID, commercialTypeID sql.NullString
		var latitude, longitude sql.NullFloat64
		if err := rows.Scan(&record.ID, &record.ContactPhoneE164, &record.BusinessName, &record.FirstStoreName, &actorID, &originActorID, &origin, &record.State, &correctionReason, &reviewedBy, &record.Version, &record.CreatedAt, &record.UpdatedAt, &cityID, &verticalID, &commercialTypeID, &latitude, &longitude, &record.WalletProviderKey); err != nil {
			return JoiningCaseListResult{}, fmt.Errorf("scan Field joining case queue: %w", err)
		}
		if actorID.Valid {
			record.PartnerActorID = actorID.String
		}
		if originActorID.Valid {
			record.OriginatingFieldActorID = originActorID.String
		}
		if origin.Valid {
			record.Origin = origin.String
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
		if commercialTypeID.Valid {
			record.FirstStoreCommercialTypeID = commercialTypeID.String
		}
		record.FirstStoreLatitude = nullableFloat(latitude)
		record.FirstStoreLongitude = nullableFloat(longitude)
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return JoiningCaseListResult{}, fmt.Errorf("read Field joining case queue: %w", err)
	}
	result := JoiningCaseListResult{Cases: items}
	if len(items) > limit {
		last := items[limit-1]
		result.Cases = items[:limit]
		result.NextCursor, err = encodeJoiningCaseCursor(joiningCaseCursor{Version: 1, Scope: "field", CreatedAt: last.CreatedAt, ID: last.ID, Sort: "created_desc", Query: queryText, FieldActorID: fieldActorID})
		if err != nil {
			return JoiningCaseListResult{}, err
		}
	}
	return result, nil
}

const joiningCaseSelect = `SELECT c.id,c.contact_phone_e164,c.owner_full_name,c.business_name,c.first_store_name,c.first_store_address,c.first_store_working_hours,c.first_store_proof_type,c.first_store_notes,
	EXISTS(SELECT 1 FROM dsh.joining_case_private_evidence e WHERE e.joining_case_id=c.id AND e.proof_number_ciphertext IS NOT NULL),
	EXISTS(SELECT 1 FROM dsh.joining_case_private_evidence e WHERE e.joining_case_id=c.id AND e.proof_image_ciphertext IS NOT NULL),
	c.partner_actor_id,c.originating_field_actor_id,c.origin,c.state,c.settlement_period,c.financial_profile_id,c.financial_profile_state,c.correction_reason,c.reviewed_by,c.store_id,c.version,c.created_at,c.updated_at,c.first_store_service_city_id,c.first_store_vertical_id,c.first_store_commercial_type_id,c.first_store_latitude,c.first_store_longitude,c.first_store_fulfillment_modes,c.terms_policy_version,COALESCE(c.wallet_provider_key,''),
	 s.id,s.partner_actor_id,s.name,s.service_city_id,s.primary_vertical_id,s.commercial_store_type_id,s.version,s.publication_state,s.publication_changed_at,s.created_at,s.updated_at,s.delivery_origin_latitude,s.delivery_origin_longitude,s.delivery_origin_version,s.delivery_origin_updated_at,s.fulfillment_modes FROM dsh.joining_cases c LEFT JOIN dsh.stores s ON s.id=c.store_id`

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
	if err != nil {
		return JoiningCaseResult{}, err
	}
	record.StoreProfileImage, err = readStoreProfileMediaWithQuery(ctx, tx, record.ID, record.StoreID)
	return JoiningCaseResult{Case: record}, err
}

func readJoiningCaseRow(ctx context.Context, row rowScanner, _ bool) (JoiningCaseRecord, error) {
	var record JoiningCaseRecord
	var ownerFullName, firstStoreAddress, firstStoreProofType, firstStoreNotes sql.NullString
	var proofNumberPresent, proofImageUploaded bool
	var actorID, originatingFieldActorID, origin, settlementPeriod, financialProfileID, financialProfileState, correctionReason, reviewedBy, storeID, cityID, verticalID, commercialTypeID, termsPolicyVersion sql.NullString
	var latitude, longitude sql.NullFloat64
	var workingHours []byte
	var store StoreRecord
	var storeIDValue, storePartner, storeName, storeCityID, storeVerticalID, storeCommercialTypeID, storeState sql.NullString
	var storeVersion sql.NullInt64
	var storeChanged, storeCreated, storeUpdated, storeOriginUpdated sql.NullTime
	var storeOriginLatitude, storeOriginLongitude sql.NullFloat64
	var storeOriginVersion sql.NullInt64
	err := row.Scan(&record.ID, &record.ContactPhoneE164, &ownerFullName, &record.BusinessName, &record.FirstStoreName, &firstStoreAddress, &workingHours, &firstStoreProofType, &firstStoreNotes, &proofNumberPresent, &proofImageUploaded, &actorID, &originatingFieldActorID, &origin, &record.State, &settlementPeriod, &financialProfileID, &financialProfileState, &correctionReason, &reviewedBy, &storeID, &record.Version, &record.CreatedAt, &record.UpdatedAt, &cityID, &verticalID, &commercialTypeID, &latitude, &longitude, pq.Array(&record.FirstStoreFulfillmentModes), &termsPolicyVersion, &record.WalletProviderKey,
		&storeIDValue, &storePartner, &storeName, &storeCityID, &storeVerticalID, &storeCommercialTypeID, &storeVersion, &storeState, &storeChanged, &storeCreated, &storeUpdated, &storeOriginLatitude, &storeOriginLongitude, &storeOriginVersion, &storeOriginUpdated, pq.Array(&store.FulfillmentModes))
	if err != nil {
		return JoiningCaseRecord{}, err
	}
	if ownerFullName.Valid {
		record.OwnerFullName = ownerFullName.String
	}
	if firstStoreAddress.Valid {
		record.FirstStoreAddress = firstStoreAddress.String
	}
	if len(workingHours) > 0 {
		record.FirstStoreWorkingHours = append(json.RawMessage(nil), workingHours...)
	}
	if firstStoreProofType.Valid {
		record.FirstStoreProofType = firstStoreProofType.String
	}
	if firstStoreNotes.Valid {
		record.FirstStoreNotes = firstStoreNotes.String
	}
	record.FirstStoreProofNumberPresent = proofNumberPresent
	record.FirstStoreProofImageUploaded = proofImageUploaded
	if actorID.Valid {
		record.PartnerActorID = actorID.String
	}
	if originatingFieldActorID.Valid {
		record.OriginatingFieldActorID = originatingFieldActorID.String
	}
	if origin.Valid {
		record.Origin = origin.String
	}
	if settlementPeriod.Valid {
		record.SettlementPeriod = settlementPeriod.String
	}
	if termsPolicyVersion.Valid {
		record.TermsPolicyVersion = termsPolicyVersion.String
	}
	if financialProfileID.Valid {
		record.FinancialProfileID = financialProfileID.String
	}
	if financialProfileState.Valid {
		record.FinancialProfileState = financialProfileState.String
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
	if commercialTypeID.Valid {
		record.FirstStoreCommercialTypeID = commercialTypeID.String
	}
	record.FirstStoreLatitude = nullableFloat(latitude)
	record.FirstStoreLongitude = nullableFloat(longitude)
	if storeIDValue.Valid {
		store.ID = storeIDValue.String
		store.PartnerActorID = storePartner.String
		store.Name = storeName.String
		store.ServiceCityID = storeCityID.String
		store.PrimaryVerticalID = storeVerticalID.String
		if storeCommercialTypeID.Valid {
			store.CommercialStoreTypeID = storeCommercialTypeID.String
		}
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

func ListPendingFinancialProfileBindings(ctx context.Context, db *sql.DB, limit int) ([]PendingFinancialProfileBinding, error) {
	if db == nil || limit < 1 || limit > 100 {
		return nil, ErrJoiningCaseInvalidLimit
	}
	rows, err := db.QueryContext(ctx, `SELECT id,case_id,idempotency_key,request_hash,correlation_id,acting_actor_id,partner_actor_id,origin,settlement_period,COALESCE(terms_policy_version,''),COALESCE(financial_profile_id,''),attempts FROM dsh.joining_case_financial_profile_outbox WHERE state <> 'ACTIVE' AND next_attempt_at <= clock_timestamp() ORDER BY next_attempt_at ASC,created_at ASC,id ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending financial profile bindings: %w", err)
	}
	defer rows.Close()
	items := make([]PendingFinancialProfileBinding, 0, limit)
	for rows.Next() {
		var item PendingFinancialProfileBinding
		if err := rows.Scan(&item.ID, &item.CaseID, &item.IdempotencyKey, &item.RequestHash, &item.CorrelationID, &item.ActingActorID, &item.PartnerActorID, &item.Origin, &item.SettlementPeriod, &item.TermsPolicyVersion, &item.FinancialProfileID, &item.Attempts); err != nil {
			return nil, fmt.Errorf("scan pending financial profile binding: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read pending financial profile bindings: %w", err)
	}
	return items, nil
}

func ReadPendingFinancialProfileBinding(ctx context.Context, db *sql.DB, caseID string) (PendingFinancialProfileBinding, error) {
	if db == nil || strings.TrimSpace(caseID) == "" {
		return PendingFinancialProfileBinding{}, ErrFinancialProfileBindingNotFound
	}
	var item PendingFinancialProfileBinding
	err := db.QueryRowContext(ctx, `SELECT id,case_id,idempotency_key,request_hash,correlation_id,acting_actor_id,partner_actor_id,origin,settlement_period,COALESCE(terms_policy_version,''),COALESCE(financial_profile_id,''),attempts FROM dsh.joining_case_financial_profile_outbox WHERE case_id=$1 AND state <> 'ACTIVE'`, strings.TrimSpace(caseID)).Scan(&item.ID, &item.CaseID, &item.IdempotencyKey, &item.RequestHash, &item.CorrelationID, &item.ActingActorID, &item.PartnerActorID, &item.Origin, &item.SettlementPeriod, &item.TermsPolicyVersion, &item.FinancialProfileID, &item.Attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return PendingFinancialProfileBinding{}, ErrFinancialProfileBindingNotFound
	}
	if err != nil {
		return PendingFinancialProfileBinding{}, fmt.Errorf("read pending financial profile binding: %w", err)
	}
	return item, nil
}

func MarkFinancialProfilePrepared(ctx context.Context, db *sql.DB, caseID, outboxID, profileID string) error {
	if db == nil || strings.TrimSpace(caseID) == "" || strings.TrimSpace(outboxID) == "" || strings.TrimSpace(profileID) == "" {
		return errors.New("financial profile binding input is invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_case_financial_profile_outbox SET financial_profile_id=$3,attempts=attempts+1,last_error=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND case_id=$2 AND state <> 'ACTIVE'`, outboxID, caseID, profileID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_cases SET financial_profile_id=$2,financial_profile_state='PENDING_BINDING',updated_at=clock_timestamp() WHERE id=$1 AND financial_profile_state <> 'ACTIVE'`, caseID, profileID); err != nil {
		return err
	}
	return tx.Commit()
}

func MarkFinancialProfileActive(ctx context.Context, db *sql.DB, caseID, outboxID string) error {
	if db == nil || strings.TrimSpace(caseID) == "" || strings.TrimSpace(outboxID) == "" {
		return errors.New("financial profile binding input is invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_case_financial_profile_outbox SET state='ACTIVE',attempts=attempts+1,last_error=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND case_id=$2`, outboxID, caseID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_cases SET financial_profile_state='ACTIVE',updated_at=clock_timestamp() WHERE id=$1`, caseID); err != nil {
		return err
	}
	return tx.Commit()
}

func MarkFinancialProfileBindingFailure(ctx context.Context, db *sql.DB, outboxID, message string) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("financial profile outbox input is invalid")
	}
	message = strings.TrimSpace(message)
	if len(message) > 1000 {
		message = message[:1000]
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var caseID string
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.joining_case_financial_profile_outbox SET state='FAILED',attempts=attempts+1,last_error=NULLIF($2,''),next_attempt_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1 RETURNING case_id`, strings.TrimSpace(outboxID), message).Scan(&caseID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_cases SET financial_profile_state='FAILED',updated_at=clock_timestamp() WHERE id=$1 AND financial_profile_state <> 'ACTIVE'`, caseID); err != nil {
		return err
	}
	return tx.Commit()
}

func HasActiveFinancialProfileForPartner(ctx context.Context, db *sql.DB, partnerActorID string) (bool, error) {
	if db == nil || strings.TrimSpace(partnerActorID) == "" {
		return false, errors.New("partner actor is required")
	}
	var active bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.joining_cases WHERE partner_actor_id=$1 AND financial_profile_state='ACTIVE')`, strings.TrimSpace(partnerActorID)).Scan(&active)
	return active, err
}

func ResetFailedFinancialProfileBindings(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return errors.New("DSH database is nil")
	}
	_, err := db.ExecContext(ctx, `UPDATE dsh.joining_case_financial_profile_outbox SET state='PENDING',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE state='FAILED'`)
	return err
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

type updateJoiningCaseReviewStateInput struct {
	Current                                               JoiningCaseRecord
	State, ActorID, ReviewedBy, CorrectionReason, StoreID string
	SettlementPeriod, TermsPolicyVersion                  string
	ExpectedVersion                                       int
}

func updateJoiningCaseReviewStateTx(ctx context.Context, tx *sql.Tx, input updateJoiningCaseReviewStateInput) (JoiningCaseRecord, error) {
	current := input.Current
	state, actorID, reviewedBy, correctionReason, storeID := input.State, input.ActorID, input.ReviewedBy, input.CorrectionReason, input.StoreID
	settlementPeriod, termsPolicyVersion, expectedVersion := input.SettlementPeriod, input.TermsPolicyVersion, input.ExpectedVersion
	financialProfileState := "REQUIRED"
	if state == "approved" {
		financialProfileState = "PENDING_BINDING"
	}
	row := tx.QueryRowContext(ctx, `UPDATE dsh.joining_cases SET partner_actor_id=NULLIF($2,''),state=$3,correction_reason=NULLIF($4,''),reviewed_by=NULLIF($5,''),store_id=NULLIF($6,''),settlement_period=CASE WHEN $3='approved' THEN NULLIF($7::text,'') ELSE NULL END,terms_policy_version=CASE WHEN $3='approved' THEN NULLIF($8::text,'') ELSE NULL END,financial_profile_id=NULL,financial_profile_state=$9,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$10 RETURNING id`, current.ID, actorID, state, correctionReason, reviewedBy, storeID, settlementPeriod, termsPolicyVersion, financialProfileState, expectedVersion)
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
