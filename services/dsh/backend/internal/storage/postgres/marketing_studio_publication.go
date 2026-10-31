package postgres

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

const StudioPublicationSchemaVersion = 1

var ErrStudioPublicationInvalid = errors.New("studio published theme is invalid")
var ErrStudioPublicationConflict = errors.New("studio published theme version or idempotency conflict")

type StudioPublishedPalette struct {
	Navy      string `json:"navy"`
	Orange    string `json:"orange"`
	White     string `json:"white"`
	Turquoise string `json:"turquoise"`
	Burgundy  string `json:"burgundy"`
}

type StudioPublicationRecord struct {
	SchemaVersion      int                     `json:"schemaVersion"`
	TemplateKey        string                  `json:"templateKey"`
	Version            int                     `json:"version"`
	Palette            *StudioPublishedPalette `json:"palette"`
	PublishedByActorID string                  `json:"publishedByActorId,omitempty"`
}

func studioColorLuminance(value string) float64 {
	b, err := hex.DecodeString(strings.TrimPrefix(value, "#"))
	if err != nil || len(b) != 3 {
		return -1
	}
	ch := func(x byte) float64 {
		v := float64(x) / 255
		if v <= 0.04045 {
			return v / 12.92
		}
		return math.Pow((v+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(b[0]) + 0.7152*ch(b[1]) + 0.0722*ch(b[2])
}

func studioContrast(a, b string) float64 {
	x := studioColorLuminance(a)
	y := studioColorLuminance(b)
	if x < 0 || y < 0 {
		return 0
	}
	return (math.Max(x, y) + 0.05) / (math.Min(x, y) + 0.05)
}

// ValidateStudioPublishedPalette enforces the three text/background contrast
// relationships the native semantic theme projects, without accepting CSS.
func ValidateStudioPublishedPalette(raw json.RawMessage) (*StudioPublishedPalette, error) {
	if len(raw) < 2 || len(raw) > 1024 ||
		!studioExactKeys(raw, "navy", "orange", "white", "turquoise", "burgundy") {
		return nil, ErrStudioPublicationInvalid
	}
	var value StudioPublishedPalette
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, ErrStudioPublicationInvalid
	}
	colors := []*string{&value.Navy, &value.Orange, &value.White, &value.Turquoise, &value.Burgundy}
	for _, item := range colors {
		if !studioHexPattern.MatchString(*item) {
			return nil, ErrStudioPublicationInvalid
		}
		*item = strings.ToUpper(*item)
	}
	if studioColorLuminance(value.White) < 0.6 ||
		studioContrast(value.Navy, value.White) < 4.5 ||
		studioContrast(value.White, value.Burgundy) < 4.5 ||
		studioContrast(value.Navy, value.Turquoise) < 4.5 {
		return nil, ErrStudioPublicationInvalid
	}
	return &value, nil
}

func studioPublicationFromBytes(version int, paletteJSON []byte, actor string) (StudioPublicationRecord, error) {
	result := StudioPublicationRecord{
		SchemaVersion:      StudioPublicationSchemaVersion,
		TemplateKey:        StudioTemplateKey,
		Version:            version,
		PublishedByActorID: actor,
	}
	if len(paletteJSON) == 0 {
		return result, nil
	}
	value, err := ValidateStudioPublishedPalette(paletteJSON)
	if err != nil {
		return StudioPublicationRecord{}, err
	}
	result.Palette = value
	return result, nil
}

func ReadStudioPublication(ctx context.Context, db *sql.DB) (StudioPublicationRecord, error) {
	var version int
	var paletteJSON []byte
	var actor string
	err := db.QueryRowContext(ctx,
		"SELECT publication_version,published_palette_json,published_by_actor_id FROM dsh.marketing_studio_drafts WHERE template_key=$1",
		StudioTemplateKey,
	).Scan(&version, &paletteJSON, &actor)
	if err != nil {
		return StudioPublicationRecord{}, err
	}
	return studioPublicationFromBytes(version, paletteJSON, actor)
}

// SetStudioPublication serializes public visual-state changes with the draft
// and keeps every historical published state addressable for rollback. Version
// 1 is the compiled-default theme; restoring defaults never rewrites code.
func SetStudioPublication(ctx context.Context, db *sql.DB, action string,
	expectedPublicationVersion, expectedDraftVersion, targetPublicationVersion int,
	actor, correlation, idempotency string) (StudioPublicationRecord, bool, error) {
	if expectedPublicationVersion < 1 || len(strings.TrimSpace(actor)) == 0 ||
		len(correlation) < 8 || len(correlation) > 128 ||
		len(idempotency) < 8 || len(idempotency) > 128 {
		return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
	}
	switch action {
	case "ACTIVATE_DRAFT":
		if expectedDraftVersion < 1 || targetPublicationVersion != 0 {
			return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
		}
	case "RESTORE_DEFAULTS":
		if expectedDraftVersion != 0 || targetPublicationVersion != 0 {
			return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
		}
	case "ROLLBACK":
		if expectedDraftVersion != 0 || targetPublicationVersion < 1 ||
			targetPublicationVersion >= expectedPublicationVersion {
			return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
		}
	default:
		return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
	}
	requestHash := HashMarketingFacts(
		"studio-publication:v1", action,
		fmt.Sprint(expectedPublicationVersion), fmt.Sprint(expectedDraftVersion),
		fmt.Sprint(targetPublicationVersion), actor,
	)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StudioPublicationRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var currentDraftVersion, currentPublicationVersion int
	var draftJSON, previousPalette []byte
	err = tx.QueryRowContext(ctx,
		"SELECT version,publication_version,document_json,published_palette_json FROM dsh.marketing_studio_drafts WHERE template_key=$1 FOR UPDATE",
		StudioTemplateKey,
	).Scan(&currentDraftVersion, &currentPublicationVersion, &draftJSON, &previousPalette)
	if err != nil {
		return StudioPublicationRecord{}, false, err
	}
	var priorHash, priorActor string
	var replayVersion int
	var replayPalette []byte
	err = tx.QueryRowContext(ctx,
		"SELECT request_hash,result_version,result_palette_json,acting_actor_id FROM dsh.marketing_studio_publication_events WHERE idempotency_key=$1",
		idempotency,
	).Scan(&priorHash, &replayVersion, &replayPalette, &priorActor)
	if err == nil {
		if priorHash != requestHash {
			return StudioPublicationRecord{}, false, ErrStudioPublicationConflict
		}
		replay, err := studioPublicationFromBytes(replayVersion, replayPalette, priorActor)
		if err != nil {
			return StudioPublicationRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return StudioPublicationRecord{}, false, err
		}
		return replay, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StudioPublicationRecord{}, false, err
	}
	if currentPublicationVersion != expectedPublicationVersion {
		return StudioPublicationRecord{}, false, ErrStudioPublicationConflict
	}
	var nextPalette []byte
	switch action {
	case "ACTIVATE_DRAFT":
		if currentDraftVersion != expectedDraftVersion {
			return StudioPublicationRecord{}, false, ErrStudioPublicationConflict
		}
		canonical, err := ValidateStudioDocument(draftJSON)
		if err != nil {
			return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
		}
		var document studioDraftDocument
		if err := json.Unmarshal(canonical, &document); err != nil {
			return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
		}
		raw, err := json.Marshal(document.Palette)
		if err != nil {
			return StudioPublicationRecord{}, false, err
		}
		parsed, err := ValidateStudioPublishedPalette(raw)
		if err != nil {
			return StudioPublicationRecord{}, false, err
		}
		nextPalette, err = json.Marshal(parsed)
		if err != nil {
			return StudioPublicationRecord{}, false, err
		}
	case "ROLLBACK":
		if targetPublicationVersion != 1 {
			err := tx.QueryRowContext(ctx,
				"SELECT result_palette_json FROM dsh.marketing_studio_publication_events WHERE template_key=$1 AND result_version=$2",
				StudioTemplateKey, targetPublicationVersion,
			).Scan(&nextPalette)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return StudioPublicationRecord{}, false, ErrStudioPublicationInvalid
				}
				return StudioPublicationRecord{}, false, err
			}
			if len(nextPalette) > 0 {
				if _, err := ValidateStudioPublishedPalette(nextPalette); err != nil {
					return StudioPublicationRecord{}, false, err
				}
			}
		}
	}
	nextVersion := currentPublicationVersion + 1
	var newArg, previousArg any
	if len(nextPalette) > 0 {
		newArg = string(nextPalette)
	}
	if len(previousPalette) > 0 {
		previousArg = string(previousPalette)
	}
	_, err = tx.ExecContext(ctx,
		"UPDATE dsh.marketing_studio_drafts SET published_palette_json=$1::jsonb,publication_version=$2,published_by_actor_id=$3,published_at=clock_timestamp() WHERE template_key=$4",
		newArg, nextVersion, actor, StudioTemplateKey,
	)
	if err != nil {
		return StudioPublicationRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx,
		"INSERT INTO dsh.marketing_studio_publication_events (idempotency_key,request_hash,template_key,action,expected_version,result_version,source_draft_version,target_publication_version,previous_palette_json,result_palette_json,acting_actor_id,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)",
		idempotency, requestHash, StudioTemplateKey, action,
		expectedPublicationVersion, nextVersion,
		sql.NullInt64{Int64: int64(expectedDraftVersion), Valid: expectedDraftVersion > 0},
		sql.NullInt64{Int64: int64(targetPublicationVersion), Valid: targetPublicationVersion > 0},
		previousArg, newArg, actor, correlation,
	)
	if err != nil {
		return StudioPublicationRecord{}, false, err
	}
	result, err := studioPublicationFromBytes(nextVersion, nextPalette, actor)
	if err != nil {
		return StudioPublicationRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StudioPublicationRecord{}, false, err
	}
	return result, false, nil
}

type StudioPublicationHistoryItem struct {
	Version            int    `json:"version"`
	Action             string `json:"action"`
	PublishedByActorID string `json:"publishedByActorId"`
	CreatedAt          string `json:"createdAt"`
}

func ReadStudioPublicationHistory(ctx context.Context, db *sql.DB) ([]StudioPublicationHistoryItem, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT result_version,action,acting_actor_id,created_at::text FROM dsh.marketing_studio_publication_events WHERE template_key=$1 ORDER BY result_version DESC LIMIT 20",
		StudioTemplateKey,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]StudioPublicationHistoryItem, 0, 20)
	for rows.Next() {
		var item StudioPublicationHistoryItem
		if err := rows.Scan(&item.Version, &item.Action, &item.PublishedByActorID, &item.CreatedAt); err != nil {
			return nil, err
		}
		values = append(values, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return values, nil
}
