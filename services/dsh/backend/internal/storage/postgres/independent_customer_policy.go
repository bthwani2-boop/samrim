package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrIndependentCustomerPolicyInvalid  = errors.New("independent customer policy draft is invalid")
	ErrIndependentCustomerPolicyVersion  = errors.New("independent customer policy version conflict")
	ErrIndependentCustomerPolicyConflict = errors.New("independent customer policy idempotency conflict")
)

// IndependentCustomerPolicyDraftInput is merchant-authored customer-facing
// language. Store owner, reviewer, publication status, and policy version are
// NOT user-selectable fields; they are owned by the DSH server.
type IndependentCustomerPolicyDraftInput struct {
	ExpectedVersion   int    `json:"expectedVersion"`
	CancellationTerms string `json:"cancellationTerms"`
	ReturnsTerms      string `json:"returnsTerms"`
	FulfillmentTerms  string `json:"fulfillmentTerms"`
	CollectionTerms   string `json:"collectionTerms"`
}

type IndependentCustomerPolicyRecord struct {
	StoreID           string     `json:"storeId"`
	Version           int        `json:"version"`
	PolicyVersion     string     `json:"policyVersion"`
	ReviewState       string     `json:"reviewState"`
	CancellationTerms string     `json:"cancellationTerms"`
	ReturnsTerms      string     `json:"returnsTerms"`
	FulfillmentTerms  string     `json:"fulfillmentTerms"`
	CollectionTerms   string     `json:"collectionTerms"`
	UpdatedAt         *time.Time `json:"updatedAt,omitempty"`
}

func normalizeIndependentCustomerPolicyDraft(input IndependentCustomerPolicyDraftInput) (IndependentCustomerPolicyDraftInput, error) {
	input.CancellationTerms = strings.TrimSpace(input.CancellationTerms)
	input.ReturnsTerms = strings.TrimSpace(input.ReturnsTerms)
	input.FulfillmentTerms = strings.TrimSpace(input.FulfillmentTerms)
	input.CollectionTerms = strings.TrimSpace(input.CollectionTerms)
	if input.ExpectedVersion < 0 {
		return IndependentCustomerPolicyDraftInput{}, ErrIndependentCustomerPolicyInvalid
	}
	for _, term := range []string{input.CancellationTerms, input.ReturnsTerms, input.FulfillmentTerms, input.CollectionTerms} {
		if !utf8.ValidString(term) || strings.ContainsRune(term, '\x00') ||
			utf8.RuneCountInString(term) < 2 || utf8.RuneCountInString(term) > 4000 {
			return IndependentCustomerPolicyDraftInput{}, ErrIndependentCustomerPolicyInvalid
		}
	}
	return input, nil
}

// ReadIndependentCustomerPolicyForOwner is a private owner-only preview. A
// first-time independent Store has no policy row and reads as a safe draft v0.
// trustedOwnerActorID MUST originate from authenticated Identity context.
func ReadIndependentCustomerPolicyForOwner(ctx context.Context, db *sql.DB, storeID, trustedOwnerActorID string) (IndependentCustomerPolicyRecord, error) {
	storeID = strings.TrimSpace(storeID)
	trustedOwnerActorID = strings.TrimSpace(trustedOwnerActorID)
	if db == nil || storeID == "" || trustedOwnerActorID == "" {
		return IndependentCustomerPolicyRecord{}, ErrStoreNotFound
	}
	record := IndependentCustomerPolicyRecord{StoreID: storeID}
	var updated sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT COALESCE(p.version,0),COALESCE(p.policy_version,''),
		COALESCE(p.review_state,'NOT_CHECKED'),COALESCE(p.cancellation_terms,''),
		COALESCE(p.returns_terms,''),COALESCE(p.fulfillment_terms,''),
		COALESCE(p.collection_terms,''),p.updated_at
		FROM dsh.stores s
		LEFT JOIN dsh.independent_store_customer_policies p ON p.store_id=s.id
		WHERE s.id=$1 AND s.partner_actor_id=$2 AND s.relation_model='INDEPENDENT_STORE'
		AND s.deleted_at IS NULL`, storeID, trustedOwnerActorID).
		Scan(&record.Version, &record.PolicyVersion, &record.ReviewState,
			&record.CancellationTerms, &record.ReturnsTerms, &record.FulfillmentTerms,
			&record.CollectionTerms, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentCustomerPolicyRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentCustomerPolicyRecord{}, fmt.Errorf("read owned independent customer policy: %w", err)
	}
	if updated.Valid {
		record.UpdatedAt = &updated.Time
	}
	return record, nil
}

// SaveIndependentCustomerPolicyDraftForOwner is DSH's only merchant-authored
// policy writer. The authenticated actor must be supplied by trusted transport.
// It NEVER marks a policy PASSED, publishes a policy or accepts hosting terms.
// A changed draft revokes any previous policy review/publication immediately.
func SaveIndependentCustomerPolicyDraftForOwner(ctx context.Context, db *sql.DB, storeID, trustedOwnerActorID string, raw IndependentCustomerPolicyDraftInput, idempotencyKey, correlationID string) (IndependentCustomerPolicyRecord, bool, error) {
	input, err := normalizeIndependentCustomerPolicyDraft(raw)
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	storeID = strings.TrimSpace(storeID)
	trustedOwnerActorID = strings.TrimSpace(trustedOwnerActorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || len(storeID) > 128 || trustedOwnerActorID == "" ||
		len(trustedOwnerActorID) > 128 || len(idempotencyKey) < 16 || len(idempotencyKey) > 128 ||
		len(correlationID) < 8 || len(correlationID) > 128 {
		return IndependentCustomerPolicyRecord{}, false, ErrIndependentCustomerPolicyInvalid
	}
	hashFacts, err := json.Marshal(struct {
		StoreID string                              `json:"storeId"`
		OwnerID string                              `json:"ownerId"`
		Input   IndependentCustomerPolicyDraftInput `json:"input"`
	}{storeID, trustedOwnerActorID, input})
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	requestHashBytes := sha256.Sum256(hashFacts)
	requestHash := hex.EncodeToString(requestHashBytes[:])
	attemptFacts, err := json.Marshal([]string{"dsh:independent-policy-draft:v1", storeID, trustedOwnerActorID, idempotencyKey})
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	keyHashBytes := sha256.Sum256(attemptFacts)
	keyHash := hex.EncodeToString(keyHashBytes[:])

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var actualOwner string
	err = tx.QueryRowContext(ctx, `SELECT partner_actor_id FROM dsh.stores
		WHERE id=$1 AND relation_model='INDEPENDENT_STORE' AND deleted_at IS NULL
		FOR UPDATE`, storeID).Scan(&actualOwner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && actualOwner != trustedOwnerActorID) {
		return IndependentCustomerPolicyRecord{}, false, ErrStoreNotFound
	}
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}

	var previousHash string
	var previousResult []byte
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result FROM dsh.independent_store_customer_policy_idempotency
		WHERE key_hash=$1`, keyHash).Scan(&previousHash, &previousResult)
	if err == nil {
		if previousHash != requestHash {
			return IndependentCustomerPolicyRecord{}, false, ErrIndependentCustomerPolicyConflict
		}
		var receipt IndependentCustomerPolicyRecord
		if err := json.Unmarshal(previousResult, &receipt); err != nil {
			return IndependentCustomerPolicyRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return IndependentCustomerPolicyRecord{}, false, err
		}
		return receipt, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return IndependentCustomerPolicyRecord{}, false, err
	}

	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT version FROM dsh.independent_store_customer_policies
		WHERE store_id=$1 FOR UPDATE`, storeID).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	if currentVersion != input.ExpectedVersion {
		return IndependentCustomerPolicyRecord{}, false, ErrIndependentCustomerPolicyVersion
	}
	resultVersion := currentVersion + 1
	record := IndependentCustomerPolicyRecord{
		StoreID: storeID, Version: resultVersion, PolicyVersion: "v" + strconv.Itoa(resultVersion),
		ReviewState: "NOT_CHECKED", CancellationTerms: input.CancellationTerms,
		ReturnsTerms: input.ReturnsTerms, FulfillmentTerms: input.FulfillmentTerms,
		CollectionTerms: input.CollectionTerms,
	}
	var persistedUpdatedAt time.Time
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.independent_store_customer_policies
		(store_id,version,policy_version,cancellation_terms,returns_terms,
		fulfillment_terms,collection_terms,authored_by_actor_id,
		review_state,reviewed_by_actor_id,published_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,'NOT_CHECKED',NULL,NULL)
		ON CONFLICT(store_id) DO UPDATE SET
		version=EXCLUDED.version,policy_version=EXCLUDED.policy_version,
		cancellation_terms=EXCLUDED.cancellation_terms,returns_terms=EXCLUDED.returns_terms,
		fulfillment_terms=EXCLUDED.fulfillment_terms,collection_terms=EXCLUDED.collection_terms,
		authored_by_actor_id=EXCLUDED.authored_by_actor_id,review_state='NOT_CHECKED',
		reviewed_by_actor_id=NULL,published_at=NULL,updated_at=clock_timestamp()
		RETURNING updated_at`, storeID, record.Version, record.PolicyVersion,
		record.CancellationTerms, record.ReturnsTerms, record.FulfillmentTerms,
		record.CollectionTerms, trustedOwnerActorID).Scan(&persistedUpdatedAt)
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, fmt.Errorf("save independent customer policy draft: %w", err)
	}
	record.UpdatedAt = &persistedUpdatedAt
	serialized, err := json.Marshal(record)
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_customer_policy_idempotency
		(key_hash,request_hash,store_id,owner_actor_id,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
		keyHash, requestHash, storeID, trustedOwnerActorID, string(serialized))
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, fmt.Errorf("record independent customer policy idempotency: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_store_customer_policy_audit
		(store_id,actor_id,key_hash,correlation_id,expected_version,result_version,policy_version)
		VALUES($1,$2,$3,$4,$5,$6,$7)`, storeID, trustedOwnerActorID, keyHash, correlationID,
		input.ExpectedVersion, resultVersion, record.PolicyVersion)
	if err != nil {
		return IndependentCustomerPolicyRecord{}, false, fmt.Errorf("audit independent customer policy draft: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return IndependentCustomerPolicyRecord{}, false, err
	}
	return record, false, nil
}
