package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// Case-only optional image: never associated with Store media or public discovery.
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
