package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// Case-only optional image: never associated with Store media or public discovery.
func SaveJoiningCaseReviewPhoto(ctx context.Context, db *sql.DB, caseID, fieldActorID string, expectedVersion int, idempotencyKey, correlationID, contentType string, data []byte) (JoiningCaseResult, error) {
	caseID, fieldActorID = strings.TrimSpace(caseID), strings.TrimSpace(fieldActorID)
	if db == nil || caseID == "" || fieldActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(correlationID) < 8 || len(data) == 0 || len(data) > 10*1024*1024 || (contentType != "image/jpeg" && contentType != "image/png") {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	digest := sha256.Sum256(data)
	sha := hex.EncodeToString(digest[:])
	hash := hashFacts("joining-review-photo", caseID, fieldActorID, fmt.Sprint(expectedVersion), contentType, sha)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	result, found, err := readJoiningCaseIdempotency(ctx, tx, idempotencyKey, hash, caseID, "review-photo-upload")
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
	if current.Case.Origin != "field" || current.Case.State != "draft" || current.Case.OriginatingFieldActorID != fieldActorID {
		return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
	}
	if current.Case.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO dsh.joining_case_review_photos(joining_case_id,image_bytes,content_type,content_sha256,uploaded_by_field_actor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (joining_case_id) DO UPDATE SET image_bytes=EXCLUDED.image_bytes,content_type=EXCLUDED.content_type,content_sha256=EXCLUDED.content_sha256,uploaded_by_field_actor_id=EXCLUDED.uploaded_by_field_actor_id,updated_at=clock_timestamp()", caseID, data, contentType, sha, fieldActorID)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("save joining review photo: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.joining_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2", caseID, expectedVersion); err != nil {
		return JoiningCaseResult{}, err
	}
	updated, err := readJoiningCaseTx(ctx, tx, caseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if err := recordJoiningCaseMutationTx(ctx, tx, idempotencyKey, hash, updated.Case, "review-photo-upload"); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	return ReadJoiningCaseForField(ctx, db, fieldActorID, caseID)
}

func ReadJoiningCaseReviewPhotoForOperator(ctx context.Context, db *sql.DB, caseID string) ([]byte, string, error) {
	if db == nil || strings.TrimSpace(caseID) == "" {
		return nil, "", ErrJoiningCaseNotFound
	}
	var data []byte
	var contentType string
	err := db.QueryRowContext(ctx, "SELECT image_bytes,content_type FROM dsh.joining_case_review_photos WHERE joining_case_id=$1", strings.TrimSpace(caseID)).Scan(&data, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrJoiningCaseNotFound
	}
	if err != nil {
		return nil, "", fmt.Errorf("read internal joining review photo: %w", err)
	}
	return data, contentType, nil
}
