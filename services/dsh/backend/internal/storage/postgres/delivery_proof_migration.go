package postgres

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type legacyDeliveryProof struct {
	code  string
	state string
}

// MigrateDeliveryProofCryptography converts every persisted plaintext proof
// and code-derived digest in one transaction before deleting the legacy columns.
func MigrateDeliveryProofCryptography(ctx context.Context, db *sql.DB, keys *DeliveryProofKeyring) error {
	if db == nil || keys == nil {
		return errors.New("DSH delivery proof migration configuration is invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin DSH delivery proof migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('dsh:delivery-proof-cryptography',0))"); err != nil {
		return fmt.Errorf("lock DSH delivery proof migration: %w", err)
	}
	var hasLegacyCode, hasLegacyHash, hasCiphertext, hasVerifier, hasKeyID bool
	for column, target := range map[string]*bool{
		"code": &hasLegacyCode, "code_hash": &hasLegacyHash,
		"code_ciphertext": &hasCiphertext, "code_verifier": &hasVerifier, "code_key_id": &hasKeyID,
	} {
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='dsh' AND table_name='commerce_order_delivery_proofs' AND column_name=$1)`, column).Scan(target); err != nil {
			return fmt.Errorf("inspect DSH delivery proof schema: %w", err)
		}
	}
	if !hasLegacyCode && !hasLegacyHash {
		if !hasCiphertext || !hasVerifier || !hasKeyID {
			return errors.New("DSH delivery proof schema is neither legacy nor fully migrated")
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("finish DSH delivery proof migration readback: %w", err)
		}
		return nil
	}
	if !hasLegacyCode || !hasLegacyHash || !hasCiphertext || !hasVerifier || !hasKeyID {
		return errors.New("DSH delivery proof schema is only partially prepared for migration")
	}

	rows, err := tx.QueryContext(ctx, `SELECT order_id,code,state FROM dsh.commerce_order_delivery_proofs ORDER BY order_id FOR UPDATE`)
	if err != nil {
		return fmt.Errorf("read legacy DSH delivery proofs: %w", err)
	}
	proofs := make(map[string]legacyDeliveryProof)
	for rows.Next() {
		var orderID, code, state string
		if err := rows.Scan(&orderID, &code, &state); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan legacy DSH delivery proof: %w", err)
		}
		proofs[orderID] = legacyDeliveryProof{code: code, state: state}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("read legacy DSH delivery proof rows: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close legacy DSH delivery proof rows: %w", err)
	}
	for orderID, proof := range proofs {
		if proof.state == "VERIFIED" {
			continue
		}
		if proof.state != "PENDING" || !validDeliveryProofCode(proof.code) {
			return fmt.Errorf("legacy DSH delivery proof %s is invalid", orderID)
		}
		keyID, ciphertext, err := keys.Encrypt(orderID, proof.code)
		if err != nil {
			return fmt.Errorf("encrypt legacy DSH delivery proof %s: %w", orderID, err)
		}
		verifier, err := keys.ProofVerifier(orderID, keyID, proof.code)
		if err != nil {
			return fmt.Errorf("verify legacy DSH delivery proof %s: %w", orderID, err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_delivery_proofs SET code_ciphertext=$2,code_verifier=$3,code_key_id=$4 WHERE order_id=$1`, orderID, ciphertext, verifier, keyID); err != nil {
			return fmt.Errorf("write protected DSH delivery proof %s: %w", orderID, err)
		}
	}
	if err := migrateLegacyStorePickupHashes(ctx, tx, keys, proofs); err != nil {
		return err
	}
	if err := migrateLegacyCaptainCompletionHashes(ctx, tx, keys); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `ALTER TABLE dsh.commerce_order_delivery_proofs
		DROP CONSTRAINT commerce_order_delivery_proof_code_hash_chk,
		DROP CONSTRAINT commerce_order_delivery_proof_code_chk,
		DROP COLUMN code,
		DROP COLUMN code_hash,
		ADD CONSTRAINT commerce_order_delivery_proof_material_chk CHECK (
			(state='PENDING' AND code_ciphertext IS NOT NULL AND code_verifier ~ '^[0-9a-f]{64}$' AND code_key_id ~ '^[a-zA-Z0-9_-]{1,32}$')
			OR (state='VERIFIED' AND code_ciphertext IS NULL AND code_verifier IS NULL AND code_key_id IS NULL)
		)`); err != nil {
		return fmt.Errorf("remove legacy DSH delivery proof columns: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit protected DSH delivery proof migration: %w", err)
	}
	return nil
}

func migrateLegacyStorePickupHashes(ctx context.Context, tx *sql.Tx, keys *DeliveryProofKeyring, proofs map[string]legacyDeliveryProof) error {
	rows, err := tx.QueryContext(ctx, `SELECT i.idempotency_key,i.request_hash,i.order_id,i.expected_version FROM dsh.commerce_order_transition_idempotency i WHERE i.requested_state='PICKED_UP' ORDER BY i.idempotency_key FOR UPDATE`)
	if err != nil {
		return fmt.Errorf("read legacy store pickup idempotency: %w", err)
	}
	type row struct {
		key, requestHash, orderID string
		expectedVersion           int
	}
	items := make([]row, 0)
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.key, &item.requestHash, &item.orderID, &item.expectedVersion); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan legacy store pickup idempotency: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("read legacy store pickup idempotency rows: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close legacy store pickup idempotency rows: %w", err)
	}
	for _, item := range items {
		proof, ok := proofs[item.orderID]
		if !ok || !validDeliveryProofCode(proof.code) || item.requestHash != HashStorePickupCompletion(item.orderID, proof.code, item.expectedVersion) {
			return fmt.Errorf("legacy store pickup idempotency %s cannot be safely translated", item.key)
		}
		newHash, err := keys.ActiveIdempotencyHash("store-pickup-completion", item.orderID, proof.code, strconv.Itoa(item.expectedVersion), "PICKED_UP")
		if err != nil {
			return fmt.Errorf("protect store pickup idempotency %s: %w", item.key, err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_transition_idempotency SET request_hash=$2 WHERE idempotency_key=$1`, item.key, newHash); err != nil {
			return fmt.Errorf("update store pickup idempotency %s: %w", item.key, err)
		}
		result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_audit SET request_hash=$2 WHERE idempotency_key=$1 AND event_type='order_picked_up'`, item.key, newHash)
		if err != nil {
			return fmt.Errorf("update store pickup audit %s: %w", item.key, err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("store pickup audit %s did not have exactly one matching row", item.key)
		}
	}
	return nil
}

func migrateLegacyCaptainCompletionHashes(ctx context.Context, tx *sql.Tx, keys *DeliveryProofKeyring) error {
	rows, err := tx.QueryContext(ctx, `SELECT idempotency_key,request_hash FROM dsh.captain_operation_idempotency WHERE operation='complete' ORDER BY idempotency_key FOR UPDATE`)
	if err != nil {
		return fmt.Errorf("read legacy captain completion idempotency: %w", err)
	}
	type row struct {
		key, requestHash string
	}
	items := make([]row, 0)
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.key, &item.requestHash); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan legacy captain completion idempotency: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("read legacy captain completion rows: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close legacy captain completion rows: %w", err)
	}
	for _, item := range items {
		if !isLegacySHA256(item.requestHash) {
			return fmt.Errorf("legacy captain completion idempotency %s has an invalid request digest", item.key)
		}
		newHash, err := keys.ActiveIdempotencyHash("captain-completion-legacy", item.requestHash)
		if err != nil {
			return fmt.Errorf("protect captain completion idempotency %s: %w", item.key, err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_operation_idempotency SET request_hash=$2 WHERE idempotency_key=$1 AND operation='complete'`, item.key, newHash); err != nil {
			return fmt.Errorf("update captain completion idempotency %s: %w", item.key, err)
		}
		result, err := tx.ExecContext(ctx, `UPDATE dsh.captain_audit SET request_hash=$2 WHERE idempotency_key=$1 AND event_type IN ('delivery_completed','delivery_failed')`, item.key, newHash)
		if err != nil {
			return fmt.Errorf("update captain completion audit %s: %w", item.key, err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("captain completion audit %s did not have exactly one matching row", item.key)
		}
	}
	return nil
}

func isLegacySHA256(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func legacyStorePickupRequestHash(orderID, code string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), HashDeliveryProofCode(orderID, code), strconv.Itoa(expectedVersion), "PICKED_UP")
}
