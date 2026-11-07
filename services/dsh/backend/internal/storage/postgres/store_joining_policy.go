package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrStoreJoiningClosed            = errors.New("new enrollment is closed for this Store relation")
	ErrStoreJoiningPolicyVersion     = errors.New("Store joining policy version conflict")
	ErrStoreJoiningPolicyIdempotency = errors.New("Store joining policy idempotency conflict")
	ErrStoreJoiningPolicyInput       = errors.New("invalid Store joining policy input")
)

type StoreJoiningPolicy struct {
	RelationModel     string    `json:"relationModel"`
	EnrollmentEnabled bool      `json:"enrollmentEnabled"`
	Version           int       `json:"version"`
	UpdatedBy         string    `json:"updatedBy"`
	UpdatedAt         time.Time `json:"updatedAt"`
	Reason            string    `json:"reason"`
}

// ReadStoreJoiningPolicies is the canonical projection for both partner setup
// and operator policies. Missing policy rows fail closed, never grant enrollment.
func ReadStoreJoiningPolicies(ctx context.Context, db *sql.DB) ([]StoreJoiningPolicy, error) {
	rows, err := db.QueryContext(ctx, `SELECT relation_model,enrollment_enabled,version,updated_by_actor_id,updated_at,reason
        FROM dsh.store_joining_policies ORDER BY relation_model`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	policies := make([]StoreJoiningPolicy, 0, 2)
	for rows.Next() {
		var p StoreJoiningPolicy
		if err = rows.Scan(&p.RelationModel, &p.EnrollmentEnabled, &p.Version, &p.UpdatedBy, &p.UpdatedAt, &p.Reason); err != nil {
			return nil, err
		}
		policies = append(policies, p)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(policies) != 2 || policies[0].RelationModel != StoreRelationBThwaniPartner ||
		policies[1].RelationModel != StoreRelationIndependent {
		return nil, fmt.Errorf("Store joining policies are incomplete")
	}
	return policies, nil
}

// SetStoreJoiningPolicy only changes admission for NEW Stores. Existing Stores,
// role admission, publication, and finance are unaffected.
func SetStoreJoiningPolicy(ctx context.Context, db *sql.DB, model string, enabled bool, expected int, actor, reason, key string) (StoreJoiningPolicy, error) {
	model = strings.TrimSpace(model)
	actor = strings.TrimSpace(actor)
	reason = strings.TrimSpace(reason)
	key = strings.TrimSpace(key)
	if db == nil || (model != StoreRelationBThwaniPartner && model != StoreRelationIndependent) ||
		expected < 1 || actor == "" || len(actor) > 128 || len([]rune(reason)) < 5 || len([]rune(reason)) > 500 ||
		len(key) < 8 || len(key) > 128 {
		return StoreJoiningPolicy{}, ErrStoreJoiningPolicyInput
	}
	material := fmt.Sprintf("%s\x00%t\x00%d\x00%s\x00%s", model, enabled, expected, actor, reason)
	digest := sha256.Sum256([]byte(material))
	hash := hex.EncodeToString(digest[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreJoiningPolicy{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:store-joining:"+key); err != nil {
		return StoreJoiningPolicy{}, err
	}
	var replay StoreJoiningPolicy
	var priorHash string
	err = tx.QueryRowContext(ctx, `SELECT relation_model,enrollment_enabled,result_version,actor_id,created_at,reason,request_hash
        FROM dsh.store_joining_policy_events WHERE idempotency_key=$1`, key).
		Scan(&replay.RelationModel, &replay.EnrollmentEnabled, &replay.Version, &replay.UpdatedBy, &replay.UpdatedAt, &replay.Reason, &priorHash)
	if err == nil {
		if priorHash != hash {
			return StoreJoiningPolicy{}, ErrStoreJoiningPolicyIdempotency
		}
		if err = tx.Commit(); err != nil {
			return StoreJoiningPolicy{}, err
		}
		return replay, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreJoiningPolicy{}, err
	}
	var result StoreJoiningPolicy
	err = tx.QueryRowContext(ctx, `SELECT relation_model,enrollment_enabled,version,updated_by_actor_id,updated_at,reason
        FROM dsh.store_joining_policies WHERE relation_model=$1 FOR UPDATE`, model).
		Scan(&result.RelationModel, &result.EnrollmentEnabled, &result.Version, &result.UpdatedBy, &result.UpdatedAt, &result.Reason)
	if err != nil {
		return StoreJoiningPolicy{}, err
	}
	if result.Version != expected {
		return StoreJoiningPolicy{}, ErrStoreJoiningPolicyVersion
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.store_joining_policies SET
        enrollment_enabled=$2,version=version+1,updated_by_actor_id=$3,updated_at=clock_timestamp(),reason=$4
        WHERE relation_model=$1 RETURNING relation_model,enrollment_enabled,version,updated_by_actor_id,updated_at,reason`,
		model, enabled, actor, reason).Scan(&result.RelationModel, &result.EnrollmentEnabled, &result.Version, &result.UpdatedBy, &result.UpdatedAt, &result.Reason)
	if err != nil {
		return StoreJoiningPolicy{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.store_joining_policy_events
        (idempotency_key,relation_model,request_hash,expected_version,result_version,enrollment_enabled,actor_id,reason,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		key, model, hash, expected, result.Version, enabled, actor, reason, result.UpdatedAt); err != nil {
		return StoreJoiningPolicy{}, err
	}
	if err = tx.Commit(); err != nil {
		return StoreJoiningPolicy{}, err
	}
	return result, nil
}
