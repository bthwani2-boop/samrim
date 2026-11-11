package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

var (
	ErrIndependentPublicationSubmitInvalid = errors.New("independent publication submission is invalid")
	ErrIndependentPublicationSubmitVersion = errors.New("independent publication submission version conflict")
	ErrIndependentPublicationSubmitState   = errors.New("independent publication cannot be submitted from current state")
	ErrIndependentPublicationSubmitReplay  = errors.New("independent publication submission key conflict")
	ErrIndependentPublicationSubmitPolicy  = errors.New("independent publication policy draft is not ready")
)

type IndependentPublicationSubmission struct {
	StoreID          string `json:"storeId"`
	State            string `json:"state"`
	Version          int    `json:"version"`
	IdempotentReplay bool   `json:"idempotentReplay"`
}

// SubmitIndependentPublicationForOwner never publishes or approves. The
// authenticated Partner accepts only an explicitly approved Hosting Terms
// version, then asks for independent Operator review on the canonical Store.
// A suspended Store cannot be resubmitted to evade an operator decision.
func SubmitIndependentPublicationForOwner(ctx context.Context, db *sql.DB,
	storeID, ownerID, approvedTermsVersion string, expectedVersion int, key, correlation string) (IndependentPublicationSubmission, error) {
	storeID, ownerID = strings.TrimSpace(storeID), strings.TrimSpace(ownerID)
	approvedTermsVersion = strings.TrimSpace(approvedTermsVersion)
	key, correlation = strings.TrimSpace(key), strings.TrimSpace(correlation)
	if db == nil || storeID == "" || len(storeID) > 128 || ownerID == "" || len(ownerID) > 128 ||
		approvedTermsVersion == "" || len(approvedTermsVersion) > 128 || expectedVersion < 1 ||
		len(key) < 16 || len(key) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		return IndependentPublicationSubmission{}, ErrIndependentPublicationSubmitInvalid
	}
	for _, field := range []string{storeID, ownerID, approvedTermsVersion, key, correlation} {
		if !utf8.ValidString(field) || strings.ContainsRune(field, '\x00') || strings.TrimSpace(field) != field {
			return IndependentPublicationSubmission{}, ErrIndependentPublicationSubmitInvalid
		}
	}
	hashJSON := func(data any) (string, error) {
		b, err := json.Marshal(data)
		if err != nil {
			return "", err
		}
		h := sha256.Sum256(b)
		return hex.EncodeToString(h[:]), nil
	}
	keyHash, err := hashJSON([]string{"dsh:independent-publication-submit:v1", storeID, ownerID, key})
	if err != nil {
		return IndependentPublicationSubmission{}, err
	}
	requestHash, err := hashJSON([]any{storeID, ownerID, approvedTermsVersion, expectedVersion})
	if err != nil {
		return IndependentPublicationSubmission{}, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return IndependentPublicationSubmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actualOwner string
	err = tx.QueryRowContext(ctx, `SELECT partner_actor_id FROM dsh.stores
		WHERE id=$1 AND relation_model='INDEPENDENT_STORE'
		  AND publication_state<>'published' AND deleted_at IS NULL
		FOR UPDATE`, storeID).Scan(&actualOwner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && actualOwner != ownerID) {
		return IndependentPublicationSubmission{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentPublicationSubmission{}, fmt.Errorf("lock owned independent Store: %w", err)
	}

	var state string
	var storedVersion int
	missing := false
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.independent_store_publications
		WHERE store_id=$1 FOR UPDATE`, storeID).Scan(&state, &storedVersion)
	if errors.Is(err, sql.ErrNoRows) {
		state, storedVersion, missing = "DRAFT", 1, true
	} else if err != nil {
		return IndependentPublicationSubmission{}, fmt.Errorf("read independent publication state: %w", err)
	}

	var oldHash string
	var oldVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result_version
		FROM dsh.independent_store_publication_idempotency WHERE key_hash=$1`, keyHash).Scan(&oldHash, &oldVersion)
	if err == nil {
		if oldHash != requestHash {
			return IndependentPublicationSubmission{}, ErrIndependentPublicationSubmitReplay
		}
		if err := tx.Commit(); err != nil {
			return IndependentPublicationSubmission{}, err
		}
		return IndependentPublicationSubmission{StoreID: storeID, State: "NEEDS_REVIEW", Version: oldVersion, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationSubmission{}, fmt.Errorf("read submission attempt: %w", err)
	}
	if storedVersion != expectedVersion {
		return IndependentPublicationSubmission{}, ErrIndependentPublicationSubmitVersion
	}
	switch state {
	case "DRAFT", "NEEDS_CORRECTION", "UNPUBLISHED":
	default:
		return IndependentPublicationSubmission{}, ErrIndependentPublicationSubmitState
	}

	// Merchant-owned policy must be present before a human reviewer is asked
	// to approve its consumer-facing terms. Review does not imply approval.
	var policyExists bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM dsh.independent_store_customer_policies
		WHERE store_id=$1 AND authored_by_actor_id=$2
		AND cancellation_terms<>'' AND returns_terms<>''
		AND fulfillment_terms<>'' AND collection_terms<>'')`, storeID, ownerID).Scan(&policyExists)
	if err != nil {
		return IndependentPublicationSubmission{}, fmt.Errorf("read merchant policy readiness: %w", err)
	}
	if !policyExists {
		return IndependentPublicationSubmission{}, ErrIndependentPublicationSubmitPolicy
	}

	resultVersion := storedVersion + 1
	if missing {
		_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publications
			(store_id,state,version,terms_version,terms_accepted_by_actor_id,terms_accepted_at,
			 review_state,review_reason,published_at,updated_by_actor_id)
			VALUES($1,'NEEDS_REVIEW',$2,$3,$4,clock_timestamp(),'NEEDS_REVIEW',NULL,NULL,$4)`,
			storeID, resultVersion, approvedTermsVersion, ownerID)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE dsh.independent_store_publications
			SET state='NEEDS_REVIEW',version=version+1,terms_version=$2,
			    terms_accepted_by_actor_id=$3,terms_accepted_at=clock_timestamp(),
			    review_state='NEEDS_REVIEW',review_reason=NULL,published_at=NULL,
			    updated_at=clock_timestamp(),updated_by_actor_id=$3
			WHERE store_id=$1 AND version=$4`,
			storeID, approvedTermsVersion, ownerID, expectedVersion)
	}
	if err != nil {
		return IndependentPublicationSubmission{}, fmt.Errorf("submit independent publication: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publication_idempotency
		(key_hash,request_hash,store_id,requested_state,expected_version,result_version)
		VALUES($1,$2,$3,'NEEDS_REVIEW',$4,$5)`,
		keyHash, requestHash, storeID, expectedVersion, resultVersion)
	if err != nil {
		return IndependentPublicationSubmission{}, fmt.Errorf("persist independent submission key: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publication_audit
		(store_id,from_state,to_state,expected_version,result_version,actor_id,reason,key_hash)
		VALUES($1,$2,'NEEDS_REVIEW',$3,$4,$5,'OWNER_SUBMITTED_FOR_REVIEW',$6)`,
		storeID, state, expectedVersion, resultVersion, ownerID, keyHash)
	if err != nil {
		return IndependentPublicationSubmission{}, fmt.Errorf("audit independent submission: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return IndependentPublicationSubmission{}, err
	}
	return IndependentPublicationSubmission{StoreID: storeID, State: "NEEDS_REVIEW", Version: resultVersion}, nil
}
