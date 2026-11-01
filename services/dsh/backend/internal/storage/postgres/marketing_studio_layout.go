package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var ErrStudioLayoutInvalid = errors.New("invalid published client-home layout")
var ErrStudioLayoutConflict = errors.New("client-home layout version or idempotency conflict")

// A published layout must have an actual client renderer backed by canonical data.
func ValidateStudioPublishedLayout(input json.RawMessage) (json.RawMessage, error) {
	canonical, err := ValidateStudioDocument(input)
	if err != nil {
		return nil, ErrStudioLayoutInvalid
	}
	var document studioDraftDocument
	if json.Unmarshal(canonical, &document) != nil {
		return nil, ErrStudioLayoutInvalid
	}
	for _, section := range document.Sections {
		if section.Visible && (section.ID == "topSellers" || section.ID == "testimonials") {
			return nil, ErrStudioLayoutInvalid
		}
	}
	return canonical, nil
}

// A nil Document means the compiled client-home layout, not an unpublished draft.
type StudioLayoutPublicationRecord struct {
	SchemaVersion      int             `json:"schemaVersion"`
	TemplateKey        string          `json:"templateKey"`
	Version            int             `json:"version"`
	Document           json.RawMessage `json:"document"`
	PublishedByActorID string          `json:"publishedByActorId,omitempty"`
}

func studioLayoutFromBytes(version int, document []byte, actor string) (StudioLayoutPublicationRecord, error) {
	value := StudioLayoutPublicationRecord{
		SchemaVersion: 1, TemplateKey: StudioTemplateKey,
		Version: version, Document: json.RawMessage("null"), PublishedByActorID: actor,
	}
	if len(document) == 0 {
		return value, nil
	}
	canonical, err := ValidateStudioPublishedLayout(document)
	if err != nil {
		return StudioLayoutPublicationRecord{}, ErrStudioLayoutInvalid
	}
	value.Document = canonical
	return value, nil
}

func ReadStudioLayoutPublication(ctx context.Context, db *sql.DB) (StudioLayoutPublicationRecord, error) {
	var version int
	var document []byte
	var actor string
	err := db.QueryRowContext(ctx,
		"SELECT layout_publication_version,published_layout_json,layout_published_by_actor_id FROM dsh.marketing_studio_drafts WHERE template_key=$1",
		StudioTemplateKey,
	).Scan(&version, &document, &actor)
	if err != nil {
		return StudioLayoutPublicationRecord{}, err
	}
	return studioLayoutFromBytes(version, document, actor)
}

// Layout publication is independently versioned from theme publication, under the
// same canonical DSH draft row lock. No draft is exposed before ACTIVATE_DRAFT.
func SetStudioLayoutPublication(ctx context.Context, db *sql.DB, action string,
	expectedPublicationVersion, expectedDraftVersion, targetPublicationVersion int,
	actor, correlation, idempotency string) (StudioLayoutPublicationRecord, bool, error) {
	if expectedPublicationVersion < 1 || strings.TrimSpace(actor) == "" ||
		len(correlation) < 8 || len(correlation) > 128 ||
		len(idempotency) < 8 || len(idempotency) > 128 {
		return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
	}
	switch action {
	case "ACTIVATE_DRAFT":
		if expectedDraftVersion < 1 || targetPublicationVersion != 0 {
			return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
		}
	case "RESTORE_DEFAULTS":
		if expectedDraftVersion != 0 || targetPublicationVersion != 0 {
			return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
		}
	case "ROLLBACK":
		if expectedDraftVersion != 0 || targetPublicationVersion < 1 ||
			targetPublicationVersion >= expectedPublicationVersion {
			return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
		}
	default:
		return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
	}
	requestHash := HashMarketingFacts(
		"studio-layout:v1", action,
		fmt.Sprint(expectedPublicationVersion), fmt.Sprint(expectedDraftVersion),
		fmt.Sprint(targetPublicationVersion), actor,
	)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StudioLayoutPublicationRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()

	var draftVersion, publicationVersion int
	var draftJSON, previous []byte
	err = tx.QueryRowContext(ctx,
		"SELECT version,layout_publication_version,document_json,published_layout_json FROM dsh.marketing_studio_drafts WHERE template_key=$1 FOR UPDATE",
		StudioTemplateKey,
	).Scan(&draftVersion, &publicationVersion, &draftJSON, &previous)
	if err != nil {
		return StudioLayoutPublicationRecord{}, false, err
	}

	var priorHash, priorActor string
	var replayVersion int
	var replayDocument []byte
	err = tx.QueryRowContext(ctx,
		"SELECT request_hash,result_version,result_document_json,acting_actor_id FROM dsh.marketing_studio_layout_events WHERE idempotency_key=$1",
		idempotency,
	).Scan(&priorHash, &replayVersion, &replayDocument, &priorActor)
	if err == nil {
		if priorHash != requestHash {
			return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutConflict
		}
		replay, parseErr := studioLayoutFromBytes(replayVersion, replayDocument, priorActor)
		if parseErr != nil {
			return StudioLayoutPublicationRecord{}, false, parseErr
		}
		if err := tx.Commit(); err != nil {
			return StudioLayoutPublicationRecord{}, false, err
		}
		return replay, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StudioLayoutPublicationRecord{}, false, err
	}
	if publicationVersion != expectedPublicationVersion {
		return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutConflict
	}

	var nextDocument []byte
	switch action {
	case "ACTIVATE_DRAFT":
		if draftVersion != expectedDraftVersion {
			return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutConflict
		}
		canonical, validateErr := ValidateStudioPublishedLayout(draftJSON)
		if validateErr != nil {
			return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
		}
		nextDocument = canonical
	case "ROLLBACK":
		if targetPublicationVersion != 1 {
			err = tx.QueryRowContext(ctx,
				"SELECT result_document_json FROM dsh.marketing_studio_layout_events WHERE template_key=$1 AND result_version=$2",
				StudioTemplateKey, targetPublicationVersion,
			).Scan(&nextDocument)
			if errors.Is(err, sql.ErrNoRows) {
				return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
			}
			if err != nil {
				return StudioLayoutPublicationRecord{}, false, err
			}
			if len(nextDocument) > 0 {
				canonical, validateErr := ValidateStudioDocument(nextDocument)
				if validateErr != nil {
					return StudioLayoutPublicationRecord{}, false, ErrStudioLayoutInvalid
				}
				nextDocument = canonical
			}
		}
	}

	nextVersion := publicationVersion + 1
	var newArg, oldArg any
	if len(nextDocument) > 0 {
		newArg = string(nextDocument)
	}
	if len(previous) > 0 {
		oldArg = string(previous)
	}
	_, err = tx.ExecContext(ctx,
		"UPDATE dsh.marketing_studio_drafts SET published_layout_json=$1::jsonb,layout_publication_version=$2,layout_published_by_actor_id=$3,layout_published_at=clock_timestamp() WHERE template_key=$4",
		newArg, nextVersion, actor, StudioTemplateKey,
	)
	if err != nil {
		return StudioLayoutPublicationRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx,
		"INSERT INTO dsh.marketing_studio_layout_events (idempotency_key,request_hash,template_key,action,expected_version,result_version,source_draft_version,target_publication_version,previous_document_json,result_document_json,acting_actor_id,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)",
		idempotency, requestHash, StudioTemplateKey, action,
		expectedPublicationVersion, nextVersion,
		sql.NullInt64{Int64: int64(expectedDraftVersion), Valid: expectedDraftVersion > 0},
		sql.NullInt64{Int64: int64(targetPublicationVersion), Valid: targetPublicationVersion > 0},
		oldArg, newArg, actor, correlation,
	)
	if err != nil {
		return StudioLayoutPublicationRecord{}, false, err
	}
	result, parseErr := studioLayoutFromBytes(nextVersion, nextDocument, actor)
	if parseErr != nil {
		return StudioLayoutPublicationRecord{}, false, parseErr
	}
	if err := tx.Commit(); err != nil {
		return StudioLayoutPublicationRecord{}, false, err
	}
	return result, false, nil
}

type StudioLayoutHistoryItem struct {
	Version            int    `json:"version"`
	Action             string `json:"action"`
	PublishedByActorID string `json:"publishedByActorId"`
	CreatedAt          string `json:"createdAt"`
}

func ReadStudioLayoutPublicationHistory(ctx context.Context, db *sql.DB) ([]StudioLayoutHistoryItem, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT result_version,action,acting_actor_id,created_at::text FROM dsh.marketing_studio_layout_events WHERE template_key=$1 ORDER BY result_version DESC LIMIT 20",
		StudioTemplateKey,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]StudioLayoutHistoryItem, 0, 20)
	for rows.Next() {
		var item StudioLayoutHistoryItem
		if err := rows.Scan(&item.Version, &item.Action, &item.PublishedByActorID, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
