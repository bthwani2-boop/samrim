package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

var (
	ErrCatalogProposalNotFound = errors.New("catalog Product proposal was not found")
	ErrCatalogProposalConflict = errors.New("catalog Product proposal state or version conflicts")
	ErrCatalogProposalInvalid  = errors.New("catalog Product proposal facts are invalid")
	ErrCatalogProposalReview   = errors.New("catalog Product proposal review decision is invalid")
	ErrCatalogProposalCursor   = errors.New("catalog Product proposal cursor is invalid")
)

type CatalogProductProposalRecord struct {
	ID, PartnerActorID, SubmitterRole, SubmitterActorID, JoiningCaseID string
	VerticalID, CategoryID                                             string
	ProposedName, ProposedVariantTitle                                 string
	ProposedBrand                                                      *string
	ProposedMeasurementKind, ProposedBaseUnit                          string
	ProposedIdentifierType, ProposedIdentifierValue                    *string
	AttributeValues, VariantAttributeValues                            []CatalogAttributeValueInput
	State                                                              string
	CorrectionReason, ReviewedBy                                       *string
	Version                                                            int
	CreatedAt, UpdatedAt                                               time.Time
}

type CatalogProductProposalInput struct {
	ID, PartnerActorID, SubmitterRole, SubmitterActorID, JoiningCaseID string
	VerticalID, CategoryID                                             string
	ProposedName, ProposedVariantTitle                                 string
	ProposedBrand                                                      *string
	ProposedMeasurementKind, ProposedBaseUnit                          string
	ProposedIdentifierType, ProposedIdentifierValue                    *string
	AttributeValues, VariantAttributeValues                            []CatalogAttributeValueInput
}

type CatalogProductProposalResult struct {
	Proposal CatalogProductProposalRecord
	Replayed bool
}

type CatalogProductProposalPage struct {
	Proposals  []CatalogProductProposalRecord
	NextCursor string
}

type catalogProductProposalCursor struct {
	Version        int       `json:"v"`
	Scope          string    `json:"scope"`
	State          string    `json:"state"`
	PartnerActorID string    `json:"partnerActorId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	ProposalID     string    `json:"proposalId"`
}

func validCatalogProductProposalOwner(input CatalogProductProposalInput) bool {
	role := strings.ToUpper(strings.TrimSpace(input.SubmitterRole))
	actorID := strings.TrimSpace(input.SubmitterActorID)
	partnerActorID := strings.TrimSpace(input.PartnerActorID)
	joiningCaseID := strings.TrimSpace(input.JoiningCaseID)
	if actorID == "" {
		return false
	}
	if role == "PARTNER" {
		return partnerActorID == actorID && joiningCaseID == ""
	}
	return role == "FIELD" && partnerActorID == "" && joiningCaseID != ""
}

func encodeCatalogProductProposalCursor(cursor catalogProductProposalCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeCatalogProductProposalCursor(raw, scope, state, partnerActorID string) (*catalogProductProposalCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogProposalCursor
	}
	var cursor catalogProductProposalCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.Version != 1 || cursor.Scope != scope || cursor.State != state || cursor.PartnerActorID != partnerActorID || cursor.ProposalID == "" || cursor.CreatedAt.IsZero() {
		return nil, ErrCatalogProposalCursor
	}
	return &cursor, nil
}

func HashCatalogProductProposalCreateRequest(input CatalogProductProposalInput) string {
	attributeFacts, _ := json.Marshal(struct{ Product, Variant []CatalogAttributeValueInput }{input.AttributeValues, input.VariantAttributeValues})
	return hashFacts("proposal-create", input.ID, strings.ToUpper(strings.TrimSpace(input.SubmitterRole)), strings.TrimSpace(input.SubmitterActorID), strings.TrimSpace(input.JoiningCaseID), input.VerticalID, input.CategoryID, input.ProposedName, input.ProposedVariantTitle, optionalProductFact(input.ProposedBrand), input.ProposedMeasurementKind, input.ProposedBaseUnit, optionalProductFact(input.ProposedIdentifierType), optionalProductFact(input.ProposedIdentifierValue), string(attributeFacts))
}

func HashCatalogProductProposalTransitionRequest(proposalID string, expectedVersion int) string {
	return hashFacts("proposal-submit", proposalID, strconv.Itoa(expectedVersion))
}

func HashCatalogProductProposalUpdateRequest(proposalID string, input CatalogProductProposalInput, expectedVersion int) string {
	attributeFacts, _ := json.Marshal(struct{ Product, Variant []CatalogAttributeValueInput }{input.AttributeValues, input.VariantAttributeValues})
	return hashFacts("proposal-update", proposalID, strings.ToUpper(strings.TrimSpace(input.SubmitterRole)), strings.TrimSpace(input.SubmitterActorID), strings.TrimSpace(input.JoiningCaseID), input.VerticalID, input.CategoryID, input.ProposedName, input.ProposedVariantTitle, optionalProductFact(input.ProposedBrand), input.ProposedMeasurementKind, input.ProposedBaseUnit, optionalProductFact(input.ProposedIdentifierType), optionalProductFact(input.ProposedIdentifierValue), string(attributeFacts), strconv.Itoa(expectedVersion))
}

func HashCatalogProductProposalReviewRequest(proposalID, state, reason string, expectedVersion int) string {
	return hashFacts("proposal-review", proposalID, state, reason, strconv.Itoa(expectedVersion))
}

func CreateCatalogProductProposal(ctx context.Context, db *sql.DB, input CatalogProductProposalInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductProposalResult, error) {
	if strings.TrimSpace(input.ID) == "" || !validCatalogProductProposalOwner(input) || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	}
	input.SubmitterRole = strings.ToUpper(strings.TrimSpace(input.SubmitterRole))
	input.SubmitterActorID = strings.TrimSpace(input.SubmitterActorID)
	input.JoiningCaseID = strings.TrimSpace(input.JoiningCaseID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-proposal:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductProposalResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,proposal_id,operation FROM dsh.catalog_product_proposal_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != input.ID || operation != "create" {
			return CatalogProductProposalResult{}, ErrCatalogIdempotencyConflict
		}
		proposal, readErr := readCatalogProductProposalTx(ctx, tx, storedID)
		if readErr != nil {
			return CatalogProductProposalResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogProductProposalResult{}, err
		}
		return CatalogProductProposalResult{Proposal: proposal, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, err
	}
	var verticalActive bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1 FOR SHARE", input.VerticalID).Scan(&verticalActive); errors.Is(err, sql.ErrNoRows) || !verticalActive {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	} else if err != nil {
		return CatalogProductProposalResult{}, err
	}
	var categoryVertical string
	if err = tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1 AND active=true", input.CategoryID).Scan(&categoryVertical); errors.Is(err, sql.ErrNoRows) || categoryVertical != input.VerticalID {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	} else if err != nil {
		return CatalogProductProposalResult{}, err
	}
	productAttributeValues, err := json.Marshal(input.AttributeValues)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	variantAttributeValues, err := json.Marshal(input.VariantAttributeValues)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_proposals(id,partner_actor_id,submitter_role,submitter_actor_id,joining_case_id,vertical_id,category_id,proposed_name,proposed_brand,proposed_variant_title,proposed_measurement_kind,proposed_base_unit,proposed_identifier_type,proposed_identifier_value,proposed_attribute_values,proposed_variant_attribute_values)
		VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, input.ID, input.PartnerActorID, input.SubmitterRole, input.SubmitterActorID, input.JoiningCaseID, input.VerticalID, input.CategoryID, input.ProposedName, input.ProposedBrand, input.ProposedVariantTitle, input.ProposedMeasurementKind, input.ProposedBaseUnit, input.ProposedIdentifierType, input.ProposedIdentifierValue, productAttributeValues, variantAttributeValues); err != nil {
		return CatalogProductProposalResult{}, err
	}
	proposal, err := readCatalogProductProposalTx(ctx, tx, input.ID)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_proposal_idempotency(idempotency_key,request_hash,proposal_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, input.ID, proposal.Version); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_proposal_audit(event_type,idempotency_key,correlation_id,acting_actor_id,proposal_id,from_state,to_state,result_version,request_hash) VALUES('proposal_created',$1,$2,$3,$4,NULL,$5,$6,$7)`, idempotencyKey, correlationID, actingActorID, input.ID, proposal.State, proposal.Version, requestHash); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductProposalResult{}, err
	}
	return CatalogProductProposalResult{Proposal: proposal}, nil
}

func readCatalogProductProposalTx(ctx context.Context, source rowQueryer, proposalID string) (CatalogProductProposalRecord, error) {
	return scanCatalogProductProposal(source.QueryRowContext(ctx, `SELECT id,partner_actor_id,submitter_role,submitter_actor_id,joining_case_id,vertical_id,category_id,proposed_name,proposed_brand,proposed_variant_title,proposed_measurement_kind,proposed_base_unit,proposed_identifier_type,proposed_identifier_value,proposed_attribute_values,proposed_variant_attribute_values,state,correction_reason,reviewed_by,version,created_at,updated_at FROM dsh.catalog_product_proposals WHERE id=$1`, proposalID))
}

func scanCatalogProductProposal(row rowScanner) (CatalogProductProposalRecord, error) {
	var item CatalogProductProposalRecord
	var brand, identifierType, identifierValue, correction, reviewed sql.NullString
	var partnerActorID, joiningCaseID sql.NullString
	var productAttributeValues, variantAttributeValues []byte
	err := row.Scan(&item.ID, &partnerActorID, &item.SubmitterRole, &item.SubmitterActorID, &joiningCaseID, &item.VerticalID, &item.CategoryID, &item.ProposedName, &brand, &item.ProposedVariantTitle, &item.ProposedMeasurementKind, &item.ProposedBaseUnit, &identifierType, &identifierValue, &productAttributeValues, &variantAttributeValues, &item.State, &correction, &reviewed, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalRecord{}, ErrCatalogProposalNotFound
	}
	if err != nil {
		return CatalogProductProposalRecord{}, err
	}
	if partnerActorID.Valid {
		item.PartnerActorID = partnerActorID.String
	}
	if joiningCaseID.Valid {
		item.JoiningCaseID = joiningCaseID.String
	}
	item.ProposedBrand = nullableString(brand)
	item.ProposedIdentifierType = nullableString(identifierType)
	item.ProposedIdentifierValue = nullableString(identifierValue)
	if err := json.Unmarshal(productAttributeValues, &item.AttributeValues); err != nil {
		return CatalogProductProposalRecord{}, err
	}
	if err := json.Unmarshal(variantAttributeValues, &item.VariantAttributeValues); err != nil {
		return CatalogProductProposalRecord{}, err
	}
	item.CorrectionReason = nullableString(correction)
	item.ReviewedBy = nullableString(reviewed)
	return item, nil
}

func ReadCatalogProductProposal(ctx context.Context, db *sql.DB, proposalID string) (CatalogProductProposalRecord, error) {
	return readCatalogProductProposalTx(ctx, db, strings.TrimSpace(proposalID))
}

func UpdateCatalogProductProposal(ctx context.Context, db *sql.DB, proposalID string, input CatalogProductProposalInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductProposalResult, error) {
	proposalID = strings.TrimSpace(proposalID)
	if proposalID == "" || !validCatalogProductProposalOwner(input) || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-proposal:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductProposalResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,proposal_id,operation FROM dsh.catalog_product_proposal_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != proposalID || operation != "update" {
			return CatalogProductProposalResult{}, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCatalogProductProposalTx(ctx, tx, proposalID)
		if readErr != nil {
			return CatalogProductProposalResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogProductProposalResult{}, err
		}
		return CatalogProductProposalResult{Proposal: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, err
	}
	var currentState string
	var currentVersion int
	var currentRole, currentActor, currentCase string
	if err = tx.QueryRowContext(ctx, "SELECT state,version,submitter_role,submitter_actor_id,COALESCE(joining_case_id,'') FROM dsh.catalog_product_proposals WHERE id=$1 FOR UPDATE", proposalID).Scan(&currentState, &currentVersion, &currentRole, &currentActor, &currentCase); errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, ErrCatalogProposalNotFound
	} else if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if currentRole != strings.ToUpper(strings.TrimSpace(input.SubmitterRole)) || currentActor != strings.TrimSpace(input.SubmitterActorID) || currentCase != strings.TrimSpace(input.JoiningCaseID) || currentVersion != expectedVersion || (currentState != "draft" && currentState != "needs_correction") {
		return CatalogProductProposalResult{}, ErrCatalogProposalConflict
	}
	var verticalActive bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1 FOR SHARE", input.VerticalID).Scan(&verticalActive); errors.Is(err, sql.ErrNoRows) || !verticalActive {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	} else if err != nil {
		return CatalogProductProposalResult{}, err
	}
	var categoryVertical string
	if err = tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1 AND active=true", input.CategoryID).Scan(&categoryVertical); errors.Is(err, sql.ErrNoRows) || categoryVertical != input.VerticalID {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	} else if err != nil {
		return CatalogProductProposalResult{}, err
	}
	productAttributeValues, err := json.Marshal(input.AttributeValues)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	variantAttributeValues, err := json.Marshal(input.VariantAttributeValues)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dsh.catalog_product_proposals SET vertical_id=$2,category_id=$3,proposed_name=$4,proposed_brand=$5,proposed_variant_title=$6,proposed_measurement_kind=$7,proposed_base_unit=$8,proposed_identifier_type=$9,proposed_identifier_value=$10,proposed_attribute_values=$11,proposed_variant_attribute_values=$12,state='draft',correction_reason=NULL,reviewed_by=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$13`, proposalID, input.VerticalID, input.CategoryID, input.ProposedName, input.ProposedBrand, input.ProposedVariantTitle, input.ProposedMeasurementKind, input.ProposedBaseUnit, input.ProposedIdentifierType, input.ProposedIdentifierValue, productAttributeValues, variantAttributeValues, expectedVersion); err != nil {
		return CatalogProductProposalResult{}, err
	}
	item, err := readCatalogProductProposalTx(ctx, tx, proposalID)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_proposal_idempotency(idempotency_key,request_hash,proposal_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, proposalID, item.Version); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_proposal_audit(event_type,idempotency_key,correlation_id,acting_actor_id,proposal_id,from_state,to_state,result_version,request_hash) VALUES('proposal_updated',$1,$2,$3,$4,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, proposalID, currentState, item.State, item.Version, requestHash); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductProposalResult{}, err
	}
	return CatalogProductProposalResult{Proposal: item}, nil
}

func ListCatalogProductProposalsForPartner(ctx context.Context, db *sql.DB, partnerActorID, state string, limit int, rawCursor string) (CatalogProductProposalPage, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	if partnerActorID == "" {
		return CatalogProductProposalPage{}, ErrCatalogProposalInvalid
	}
	return listCatalogProductProposals(ctx, db, "PARTNER", partnerActorID, "", state, limit, rawCursor, "partner", partnerActorID)
}

func ListCatalogProductProposalsForField(ctx context.Context, db *sql.DB, fieldActorID, joiningCaseID, state string, limit int, rawCursor string) (CatalogProductProposalPage, error) {
	fieldActorID, joiningCaseID = strings.TrimSpace(fieldActorID), strings.TrimSpace(joiningCaseID)
	if fieldActorID == "" || joiningCaseID == "" {
		return CatalogProductProposalPage{}, ErrCatalogProposalInvalid
	}
	return listCatalogProductProposals(ctx, db, "FIELD", fieldActorID, joiningCaseID, state, limit, rawCursor, "field:"+joiningCaseID, fieldActorID)
}

func ListCatalogProductProposalsForReview(ctx context.Context, db *sql.DB, state string, limit int, rawCursor string) (CatalogProductProposalPage, error) {
	return listCatalogProductProposals(ctx, db, "", "", "", state, limit, rawCursor, "review", "")
}

func listCatalogProductProposals(ctx context.Context, db *sql.DB, submitterRole, submitterActorID, joiningCaseID, state string, limit int, rawCursor, scope, cursorActorID string) (CatalogProductProposalPage, error) {
	if limit < 1 || limit > 100 {
		return CatalogProductProposalPage{}, ErrCatalogProposalInvalid
	}
	state = strings.TrimSpace(state)
	cursor, err := decodeCatalogProductProposalCursor(rawCursor, scope, state, cursorActorID)
	if err != nil {
		return CatalogProductProposalPage{}, err
	}
	var cursorCreatedAt any
	var cursorProposalID string
	if cursor != nil {
		cursorCreatedAt = cursor.CreatedAt
		cursorProposalID = cursor.ProposalID
	}
	rows, err := db.QueryContext(ctx, `SELECT id,partner_actor_id,submitter_role,submitter_actor_id,joining_case_id,vertical_id,category_id,proposed_name,proposed_brand,proposed_variant_title,proposed_measurement_kind,proposed_base_unit,proposed_identifier_type,proposed_identifier_value,proposed_attribute_values,proposed_variant_attribute_values,state,correction_reason,reviewed_by,version,created_at,updated_at
		FROM dsh.catalog_product_proposals
		WHERE ($1='' OR submitter_role=$1) AND ($2='' OR submitter_actor_id=$2) AND ($3='' OR joining_case_id=$3) AND ($4='' OR state=$4)
		AND (NOT $7::boolean OR (created_at,id)<($5::timestamptz,$6))
		ORDER BY created_at DESC,id DESC LIMIT $8`, submitterRole, submitterActorID, joiningCaseID, state, cursorCreatedAt, cursorProposalID, cursor != nil, limit+1)
	if err != nil {
		return CatalogProductProposalPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogProductProposalRecord, 0)
	for rows.Next() {
		item, err := scanCatalogProductProposal(rows)
		if err != nil {
			return CatalogProductProposalPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogProductProposalPage{}, err
	}
	page := CatalogProductProposalPage{Proposals: items}
	if len(items) > limit {
		page.Proposals = items[:limit]
		last := page.Proposals[len(page.Proposals)-1]
		page.NextCursor, err = encodeCatalogProductProposalCursor(catalogProductProposalCursor{Version: 1, Scope: scope, State: state, PartnerActorID: cursorActorID, CreatedAt: last.CreatedAt, ProposalID: last.ID})
		if err != nil {
			return CatalogProductProposalPage{}, err
		}
	}
	return page, nil
}

func SubmitCatalogProductProposal(ctx context.Context, db *sql.DB, proposalID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductProposalResult, error) {
	return transitionCatalogProductProposal(ctx, db, proposalID, "submitted", expectedVersion, "proposal_submitted", idempotencyKey, requestHash, actingActorID, correlationID)
}

func transitionCatalogProductProposal(ctx context.Context, db *sql.DB, proposalID, targetState string, expectedVersion int, eventType, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductProposalResult, error) {
	if strings.TrimSpace(proposalID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,proposal_id,operation FROM dsh.catalog_product_proposal_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != proposalID || operation != "submit" {
			return CatalogProductProposalResult{}, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCatalogProductProposalTx(ctx, tx, proposalID)
		if readErr != nil {
			return CatalogProductProposalResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogProductProposalResult{}, err
		}
		return CatalogProductProposalResult{Proposal: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, err
	}
	var currentState string
	var currentVersion int
	if err = tx.QueryRowContext(ctx, "SELECT state,version FROM dsh.catalog_product_proposals WHERE id=$1 FOR UPDATE", proposalID).Scan(&currentState, &currentVersion); errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, ErrCatalogProposalNotFound
	} else if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if currentVersion != expectedVersion || (currentState != "draft" && currentState != "needs_correction") {
		return CatalogProductProposalResult{}, ErrCatalogProposalConflict
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_product_proposals SET state='submitted',correction_reason=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2", proposalID, expectedVersion); err != nil {
		return CatalogProductProposalResult{}, err
	}
	item, err := readCatalogProductProposalTx(ctx, tx, proposalID)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_proposal_idempotency(idempotency_key,request_hash,proposal_id,operation,result_version) VALUES($1,$2,$3,'submit',$4)", idempotencyKey, requestHash, proposalID, item.Version); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_proposal_audit(event_type,idempotency_key,correlation_id,acting_actor_id,proposal_id,from_state,to_state,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, eventType, idempotencyKey, correlationID, actingActorID, proposalID, currentState, item.State, item.Version, requestHash); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductProposalResult{}, err
	}
	return CatalogProductProposalResult{Proposal: item}, nil
}

func ReviewCatalogProductProposal(ctx context.Context, db *sql.DB, proposalID, targetState, reason string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductProposalResult, error) {
	if targetState != "approved" && targetState != "rejected" && targetState != "needs_correction" {
		return CatalogProductProposalResult{}, ErrCatalogProposalReview
	}
	if targetState == "needs_correction" && strings.TrimSpace(reason) == "" {
		return CatalogProductProposalResult{}, ErrCatalogProposalReview
	}
	if strings.TrimSpace(proposalID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogProductProposalResult{}, ErrCatalogProposalInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,proposal_id,operation FROM dsh.catalog_product_proposal_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != proposalID || operation != "review" {
			return CatalogProductProposalResult{}, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCatalogProductProposalTx(ctx, tx, proposalID)
		if readErr != nil {
			return CatalogProductProposalResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogProductProposalResult{}, err
		}
		return CatalogProductProposalResult{Proposal: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, err
	}
	var currentState string
	var currentVersion int
	var verticalID, categoryID, name, variantTitle, measurementKind, baseUnit string
	var brand, identifierType, identifierValue sql.NullString
	var productAttributeJSON, variantAttributeJSON []byte
	err = tx.QueryRowContext(ctx, `SELECT state,version,vertical_id,category_id,proposed_name,proposed_brand,proposed_variant_title,proposed_measurement_kind,proposed_base_unit,proposed_identifier_type,proposed_identifier_value,proposed_attribute_values,proposed_variant_attribute_values FROM dsh.catalog_product_proposals WHERE id=$1 FOR UPDATE`, proposalID).Scan(&currentState, &currentVersion, &verticalID, &categoryID, &name, &brand, &variantTitle, &measurementKind, &baseUnit, &identifierType, &identifierValue, &productAttributeJSON, &variantAttributeJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductProposalResult{}, ErrCatalogProposalNotFound
	}
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if currentVersion != expectedVersion || currentState != "submitted" {
		return CatalogProductProposalResult{}, ErrCatalogProposalConflict
	}
	if targetState == "approved" {
		productID := "proposal_product_" + proposalID
		variantID := "proposal_variant_" + proposalID
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,brand,active) VALUES($1,$2,'SHARED',$3,$4,true)", productID, verticalID, name, nullableString(brand)); err != nil {
			return CatalogProductProposalResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active) VALUES($1,$2,$3,$4,$5,true)", variantID, productID, variantTitle, measurementKind, baseUnit); err != nil {
			return CatalogProductProposalResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES($1,$2)", productID, categoryID); err != nil {
			return CatalogProductProposalResult{}, err
		}
		var productAttributeValues, variantAttributeValues []CatalogAttributeValueInput
		if err := json.Unmarshal(productAttributeJSON, &productAttributeValues); err != nil {
			return CatalogProductProposalResult{}, err
		}
		if err := json.Unmarshal(variantAttributeJSON, &variantAttributeValues); err != nil {
			return CatalogProductProposalResult{}, err
		}
		if err := persistCatalogProductAttributes(ctx, tx, verticalID, []string{categoryID}, productID, variantID, productAttributeValues, variantAttributeValues); err != nil {
			return CatalogProductProposalResult{}, err
		}
		if identifierValue.Valid {
			if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value) VALUES($1,$2,$3)", variantID, identifierType.String, identifierValue.String); err != nil {
				if isUniqueViolation(err) {
					return CatalogProductProposalResult{}, ErrCatalogDuplicateIdentifier
				}
				return CatalogProductProposalResult{}, err
			}
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'create',1)", idempotencyKey, requestHash, productID); err != nil {
			return CatalogProductProposalResult{}, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_created',$1,$2,$3,$4,NULL,1,$5,$6,$7,$8,'SHARED')`, idempotencyKey, correlationID, actingActorID, productID, requestHash, name, nullableString(brand), verticalID); err != nil {
			return CatalogProductProposalResult{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_product_proposals SET state=$2,correction_reason=NULLIF($3,''),reviewed_by=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$5", proposalID, targetState, reason, actingActorID, expectedVersion); err != nil {
		return CatalogProductProposalResult{}, err
	}
	item, err := readCatalogProductProposalTx(ctx, tx, proposalID)
	if err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_proposal_idempotency(idempotency_key,request_hash,proposal_id,operation,result_version) VALUES($1,$2,$3,'review',$4)", idempotencyKey, requestHash, proposalID, item.Version); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_proposal_audit(event_type,idempotency_key,correlation_id,acting_actor_id,proposal_id,from_state,to_state,result_version,request_hash) VALUES('proposal_reviewed',$1,$2,$3,$4,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, proposalID, currentState, item.State, item.Version, requestHash); err != nil {
		return CatalogProductProposalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductProposalResult{}, err
	}
	return CatalogProductProposalResult{Proposal: item}, nil
}
