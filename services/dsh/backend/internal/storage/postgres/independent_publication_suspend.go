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
	ErrIndependentPublicationSuspendInvalid = errors.New("independent publication suspension is invalid")
	ErrIndependentPublicationSuspendVersion = errors.New("independent publication suspension version conflict")
	ErrIndependentPublicationSuspendReplay  = errors.New("independent publication suspension idempotency conflict")
	ErrIndependentPublicationSuspendState   = errors.New("independent publication cannot be suspended from this state")
)

// IndependentPublicationSuspension is a single, versioned, auditable safety decision.
// It cannot approve, publish, or accept Hosting Terms.
type IndependentPublicationSuspension struct {
	StoreID          string `json:"storeId"`
	State            string `json:"state"`
	Version          int    `json:"version"`
	IdempotentReplay bool   `json:"idempotentReplay"`
}

func validIndependentSuspension(storeID, actorID, reason, key, correlation string, expectedVersion int) bool {
	if expectedVersion < 1 || len(storeID) < 1 || len(storeID) > 128 ||
		len(actorID) < 1 || len(actorID) > 128 ||
		len(key) < 16 || len(key) > 128 || len(correlation) < 8 || len(correlation) > 128 ||
		len(reason) < 8 || utf8.RuneCountInString(reason) > 1000 {
		return false
	}
	for _, field := range []string{storeID, actorID, reason, key, correlation} {
		if !utf8.ValidString(field) || strings.ContainsRune(field, '\x00') || strings.TrimSpace(field) != field {
			return false
		}
	}
	return true
}

// SuspendIndependentPublication serializes on the canonical Store row, also
// locked by Direct Order checkout, before locking its independent publication.
// After commit new public reads and new direct orders reject SUSPENDED. Existing
// Orders are untouched and remain readable through their authorized paths.
func SuspendIndependentPublication(ctx context.Context, db *sql.DB, storeID, operatorActorID, reason string, expectedVersion int, idempotencyKey, correlationID string) (IndependentPublicationSuspension, error) {
	storeID, operatorActorID = strings.TrimSpace(storeID), strings.TrimSpace(operatorActorID)
	reason, idempotencyKey, correlationID = strings.TrimSpace(reason), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || !validIndependentSuspension(storeID, operatorActorID, reason, idempotencyKey, correlationID, expectedVersion) {
		return IndependentPublicationSuspension{}, ErrIndependentPublicationSuspendInvalid
	}
	hashJSON := func(value any) (string, error) {
		b, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		digest := sha256.Sum256(b)
		return hex.EncodeToString(digest[:]), nil
	}
	keyHash, err := hashJSON([]string{"dsh:independent-publication-suspend:v1", storeID, operatorActorID, idempotencyKey})
	if err != nil {
		return IndependentPublicationSuspension{}, err
	}
	requestHash, err := hashJSON(struct {
		StoreID         string `json:"storeId"`
		ActorID         string `json:"actorId"`
		Reason          string `json:"reason"`
		ExpectedVersion int    `json:"expectedVersion"`
	}{storeID, operatorActorID, reason, expectedVersion})
	if err != nil {
		return IndependentPublicationSuspension{}, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return IndependentPublicationSuspension{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var ownerID string
	err = tx.QueryRowContext(ctx, `SELECT partner_actor_id FROM dsh.stores
		WHERE id=$1 AND relation_model='INDEPENDENT_STORE' AND deleted_at IS NULL
		  AND publication_state<>'published' FOR UPDATE`, storeID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationSuspension{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentPublicationSuspension{}, fmt.Errorf("lock independent Store: %w", err)
	}

	var oldState string
	var version int
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.independent_store_publications
		WHERE store_id=$1 FOR UPDATE`, storeID).Scan(&oldState, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationSuspension{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentPublicationSuspension{}, fmt.Errorf("lock independent publication: %w", err)
	}

	// Check the persistent attempt before CAS. An exact retry is read-only,
	// even if the publication was subsequently reviewed or changed again.
	var previousHash string
	var previousVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result_version
		FROM dsh.independent_store_publication_idempotency WHERE key_hash=$1`, keyHash).
		Scan(&previousHash, &previousVersion)
	if err == nil {
		if previousHash != requestHash {
			return IndependentPublicationSuspension{}, ErrIndependentPublicationSuspendReplay
		}
		if err := tx.Commit(); err != nil {
			return IndependentPublicationSuspension{}, err
		}
		return IndependentPublicationSuspension{StoreID: storeID, State: "SUSPENDED", Version: previousVersion, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationSuspension{}, fmt.Errorf("read suspension attempt: %w", err)
	}

	if version != expectedVersion {
		return IndependentPublicationSuspension{}, ErrIndependentPublicationSuspendVersion
	}
	if oldState == "SUSPENDED" {
		return IndependentPublicationSuspension{}, ErrIndependentPublicationSuspendState
	}
	// Suspension invalidates approval and timestamp. A future release must
	// pass an independent Operator review again; marketplace state is untouched.
	resultVersion := version + 1
	result, err := tx.ExecContext(ctx, `UPDATE dsh.independent_store_publications
		SET state='SUSPENDED',review_state='NEEDS_REVIEW',published_at=NULL,
		    version=version+1,updated_at=clock_timestamp(),updated_by_actor_id=$2
		WHERE store_id=$1 AND version=$3 AND state=$4`,
		storeID, operatorActorID, expectedVersion, oldState)
	if err != nil {
		return IndependentPublicationSuspension{}, fmt.Errorf("suspend independent publication: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return IndependentPublicationSuspension{}, err
	}
	if affected != 1 {
		return IndependentPublicationSuspension{}, ErrIndependentPublicationSuspendVersion
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publication_idempotency
		(key_hash,request_hash,store_id,requested_state,expected_version,result_version)
		VALUES($1,$2,$3,'SUSPENDED',$4,$5)`,
		keyHash, requestHash, storeID, expectedVersion, resultVersion)
	if err != nil {
		return IndependentPublicationSuspension{}, fmt.Errorf("persist suspension attempt: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_publication_audit
		(store_id,from_state,to_state,expected_version,result_version,actor_id,reason,key_hash)
		VALUES($1,$2,'SUSPENDED',$3,$4,$5,$6,$7)`,
		storeID, oldState, expectedVersion, resultVersion, operatorActorID, reason, keyHash)
	if err != nil {
		return IndependentPublicationSuspension{}, fmt.Errorf("audit independent suspension: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return IndependentPublicationSuspension{}, err
	}
	return IndependentPublicationSuspension{StoreID: storeID, State: "SUSPENDED", Version: resultVersion}, nil
}
