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
	ErrIndependentPublicationReviewInvalid = errors.New("independent review decision invalid")
	ErrIndependentPublicationReviewVersion = errors.New("independent review decision version conflict")
	ErrIndependentPublicationReviewState   = errors.New("independent review transition invalid")
	ErrIndependentPublicationReviewReplay  = errors.New("independent review decision idempotency conflict")
)

type IndependentPublicationReviewDecision struct {
	StoreID          string `json:"storeId"`
	State            string `json:"state"`
	ReviewState      string `json:"reviewState"`
	Version          int    `json:"version"`
	IdempotentReplay bool   `json:"idempotentReplay"`
}

// IndependentReviewTransition is deliberately limited to decisions that cannot
// publish. Publication/approval must have separate full Legal, policy, media,
// operator and finance gates; there is no client-selectable publish action.
func independentReviewTransition(action, current string) (state, reviewState string, allowed bool) {
	switch {
	case action == "RETURN_FOR_CORRECTION" && current == "NEEDS_REVIEW":
		return "NEEDS_CORRECTION", "REJECTED", true
	case action == "REJECT" && current == "NEEDS_REVIEW":
		return "UNPUBLISHED", "REJECTED", true
	case action == "REOPEN_SUSPENSION_FOR_CORRECTION" && current == "SUSPENDED":
		return "NEEDS_CORRECTION", "REJECTED", true
	}
	return "", "", false
}

// DecideIndependentPublicationReview serializes against Direct Order checkout
// on the canonical Store row. No decision here creates a public publication,
// grants Terms consent or overwrites marketplace publication state.
func DecideIndependentPublicationReview(ctx context.Context, db *sql.DB,
	storeID, actingOperatorID, action, reason string, expectedVersion int, key, correlationID string) (IndependentPublicationReviewDecision, error) {
	storeID, actingOperatorID = strings.TrimSpace(storeID), strings.TrimSpace(actingOperatorID)
	action, reason = strings.TrimSpace(action), strings.TrimSpace(reason)
	key, correlationID = strings.TrimSpace(key), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || len(storeID) > 128 || actingOperatorID == "" || len(actingOperatorID) > 128 ||
		expectedVersion < 1 || len(key) < 16 || len(key) > 128 || len(correlationID) < 8 || len(correlationID) > 128 ||
		utf8.RuneCountInString(reason) < 8 || utf8.RuneCountInString(reason) > 1000 {
		return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewInvalid
	}
	for _, v := range []string{storeID, actingOperatorID, action, reason, key, correlationID} {
		if !utf8.ValidString(v) || strings.ContainsRune(v, '\x00') || strings.TrimSpace(v) != v {
			return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewInvalid
		}
	}
	if action != "REJECT" && action != "RETURN_FOR_CORRECTION" && action != "REOPEN_SUSPENSION_FOR_CORRECTION" {
		return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewInvalid
	}
	hash := func(v any) (string, error) {
		b, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		sum := sha256.Sum256(b)
		return hex.EncodeToString(sum[:]), nil
	}
	keyHash, err := hash([]string{"dsh:independent-publication-review:v1", storeID, actingOperatorID, key})
	if err != nil {
		return IndependentPublicationReviewDecision{}, err
	}
	requestHash, err := hash([]any{storeID, actingOperatorID, action, reason, expectedVersion})
	if err != nil {
		return IndependentPublicationReviewDecision{}, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return IndependentPublicationReviewDecision{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var owner string
	err = tx.QueryRowContext(ctx, `SELECT partner_actor_id FROM dsh.stores WHERE id=$1
		AND relation_model='INDEPENDENT_STORE' AND deleted_at IS NULL
		AND publication_state<>'published' FOR UPDATE`, storeID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationReviewDecision{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentPublicationReviewDecision{}, fmt.Errorf("lock independent Store for review: %w", err)
	}
	var state string
	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.independent_store_publications
		WHERE store_id=$1 FOR UPDATE`, storeID).Scan(&state, &currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationReviewDecision{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentPublicationReviewDecision{}, fmt.Errorf("read independent review state: %w", err)
	}
	resultState, reviewState, allowed := independentReviewTransition(action, state)
	// Replay must be checked before CAS and state transition, even if another
	// operator subsequently made a different decision on the same Store.
	var previousHash string
	var previousVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result_version FROM
		dsh.independent_store_publication_idempotency WHERE key_hash=$1`, keyHash).
		Scan(&previousHash, &previousVersion)
	if err == nil {
		if previousHash != requestHash {
			return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewReplay
		}
		resultState, reviewState, _ = independentReviewTransition(action, map[string]string{
			"REJECT": "NEEDS_REVIEW", "RETURN_FOR_CORRECTION": "NEEDS_REVIEW",
			"REOPEN_SUSPENSION_FOR_CORRECTION": "SUSPENDED"}[action])
		if err := tx.Commit(); err != nil {
			return IndependentPublicationReviewDecision{}, err
		}
		return IndependentPublicationReviewDecision{StoreID: storeID, State: resultState, ReviewState: reviewState,
			Version: previousVersion, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationReviewDecision{}, fmt.Errorf("read review idempotency: %w", err)
	}
	if currentVersion != expectedVersion {
		return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewVersion
	}
	if !allowed {
		return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewState
	}
	version := currentVersion + 1
	affected, err := tx.ExecContext(ctx, `UPDATE dsh.independent_store_publications
		SET state=$2,review_state=$3,review_reason=$4,published_at=NULL,
		    version=version+1,updated_at=clock_timestamp(),updated_by_actor_id=$5
		WHERE store_id=$1 AND version=$6 AND state=$7`,
		storeID, resultState, reviewState, reason, actingOperatorID, expectedVersion, state)
	if err != nil {
		return IndependentPublicationReviewDecision{}, fmt.Errorf("persist independent review: %w", err)
	}
	count, err := affected.RowsAffected()
	if err != nil {
		return IndependentPublicationReviewDecision{}, err
	}
	if count != 1 {
		return IndependentPublicationReviewDecision{}, ErrIndependentPublicationReviewVersion
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publication_idempotency
		(key_hash,request_hash,store_id,requested_state,expected_version,result_version)
		VALUES($1,$2,$3,$4,$5,$6)`, keyHash, requestHash, storeID, resultState, expectedVersion, version)
	if err != nil {
		return IndependentPublicationReviewDecision{}, fmt.Errorf("store independent review attempt: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publication_audit
		(store_id,from_state,to_state,expected_version,result_version,actor_id,reason,key_hash)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, storeID, state, resultState, expectedVersion, version, actingOperatorID, reason, keyHash)
	if err != nil {
		return IndependentPublicationReviewDecision{}, fmt.Errorf("audit independent review: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return IndependentPublicationReviewDecision{}, err
	}
	return IndependentPublicationReviewDecision{StoreID: storeID, State: resultState, ReviewState: reviewState, Version: version}, nil
}
