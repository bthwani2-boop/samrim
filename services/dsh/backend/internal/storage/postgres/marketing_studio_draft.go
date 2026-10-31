package postgres

import (
    "bytes"
    "context"
    "database/sql"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "regexp"
    "strings"
    "unicode/utf8"
)

const StudioTemplateKey = "CLIENT_HOME"
const maxStudioDraftBytes = 24000

var ErrStudioDraftInvalid = errors.New("invalid studio template draft")
var ErrStudioDraftConflict = errors.New("studio template draft version or idempotency conflict")

var studioHexPattern = regexp.MustCompile("^#[0-9a-fA-F]{6}$")
var studioSlideIDPattern = regexp.MustCompile("^slide-[1-9][0-9]{0,4}$")

type StudioDraftRecord struct {
    TemplateKey string          `json:"templateKey"`
    Document json.RawMessage    `json:"document"`
    Version int                 `json:"version"`
    UpdatedByActorID string     `json:"updatedByActorId"`
}

type studioDraftSection struct {
    ID string          `json:"id"`
    Visible bool       `json:"visible"`
    Title string       `json:"title"`
    Description string `json:"description"`
    Count int          `json:"count"`
}

type studioDraftSlide struct {
    ID string          `json:"id"`
    Title string       `json:"title"`
    Description string `json:"description"`
    ButtonLabel string `json:"buttonLabel"`
}

type studioDraftHeroOptions struct {
    Height string         `json:"height"`
    Align string          `json:"align"`
    ShowDescription bool  `json:"showDescription"`
    ShowButton bool       `json:"showButton"`
    ShowDots bool         `json:"showDots"`
}

type studioDraftDocument struct {
    SchemaVersion int                 `json:"schemaVersion"`
    Sections []studioDraftSection     `json:"sections"`
    HeroOptions studioDraftHeroOptions `json:"heroOptions"`
    Palette map[string]string         `json:"palette"`
    Slides []studioDraftSlide         `json:"slides"`
    Autoplay bool                      `json:"autoplay"`
    IntervalSeconds int                `json:"intervalSeconds"`
}

func studioExactKeys(raw json.RawMessage, fields ...string) bool {
    var value map[string]json.RawMessage
    if err := json.Unmarshal(raw, &value); err != nil || len(value) != len(fields) {
        return false
    }
    for _, field := range fields {
        if _, ok := value[field]; !ok {
            return false
        }
    }
    return true
}

// ValidateStudioDocument rejects unknown/missing roles, unsafe colors, duplicate
// sections, arbitrary property injection and unbounded payloads before SQL access.
// No server-side default is fabricated; clients retain the compiled Design System.
func ValidateStudioDocument(input json.RawMessage) (json.RawMessage, error) {
    if len(input) < 2 || len(input) > maxStudioDraftBytes || !utf8.Valid(input) ||
        !studioExactKeys(input, "schemaVersion", "sections", "heroOptions", "palette", "slides", "autoplay", "intervalSeconds") {
        return nil, ErrStudioDraftInvalid
    }

    var doc studioDraftDocument
    decoder := json.NewDecoder(bytes.NewReader(input))
    decoder.DisallowUnknownFields()
    if err := decoder.Decode(&doc); err != nil { return nil, ErrStudioDraftInvalid }
    var extra any
    if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) { return nil, ErrStudioDraftInvalid }
    if doc.SchemaVersion != 2 || len(doc.Sections) != 12 || len(doc.Palette) != 5 ||
        len(doc.Slides) < 1 || len(doc.Slides) > 4 ||
        doc.IntervalSeconds < 3 || doc.IntervalSeconds > 10 {
        return nil, ErrStudioDraftInvalid
    }

    sectionRoles := map[string]bool{
        "hero":true, "benefits":true, "services":true, "stores":true, "products":true, "curated":true,
        "banners":true, "topSellers":true, "promotions":true, "testimonials":true, "brands":true, "trust":true,
    }
    var raw map[string]json.RawMessage
    if err := json.Unmarshal(input, &raw); err != nil { return nil, ErrStudioDraftInvalid }
    var rawSections []json.RawMessage
    if err := json.Unmarshal(raw["sections"], &rawSections); err != nil || len(rawSections) != len(doc.Sections) {
        return nil, ErrStudioDraftInvalid
    }
    seen := make(map[string]bool, 12)
    for index, section := range doc.Sections {
        if !studioExactKeys(rawSections[index], "id", "visible", "title", "description", "count") ||
            !sectionRoles[section.ID] || seen[section.ID] ||
            utf8.RuneCountInString(section.Title) > 80 ||
            utf8.RuneCountInString(section.Description) > 180 ||
            section.Count < 1 || section.Count > 8 {
            return nil, ErrStudioDraftInvalid
        }
        seen[section.ID] = true
    }
    for id := range sectionRoles { if !seen[id] { return nil, ErrStudioDraftInvalid } }

    if !studioExactKeys(raw["heroOptions"], "height", "align", "showDescription", "showButton", "showDots") ||
        (doc.HeroOptions.Height != "compact" && doc.HeroOptions.Height != "regular" && doc.HeroOptions.Height != "tall") ||
        (doc.HeroOptions.Align != "start" && doc.HeroOptions.Align != "center" && doc.HeroOptions.Align != "end") {
        return nil, ErrStudioDraftInvalid
    }
    if !studioExactKeys(raw["palette"], "navy", "orange", "white", "turquoise", "burgundy") {
        return nil, ErrStudioDraftInvalid
    }
    for _, color := range doc.Palette {
        if !studioHexPattern.MatchString(color) { return nil, ErrStudioDraftInvalid }
    }

    var rawSlides []json.RawMessage
    if err := json.Unmarshal(raw["slides"], &rawSlides); err != nil || len(rawSlides) != len(doc.Slides) {
        return nil, ErrStudioDraftInvalid
    }
    seenSlide := make(map[string]bool, 4)
    for index, slide := range doc.Slides {
        if !studioExactKeys(rawSlides[index], "id", "title", "description", "buttonLabel") ||
            !studioSlideIDPattern.MatchString(slide.ID) || seenSlide[slide.ID] ||
            utf8.RuneCountInString(slide.Title) > 80 ||
            utf8.RuneCountInString(slide.Description) > 180 ||
            utf8.RuneCountInString(slide.ButtonLabel) > 40 {
            return nil, ErrStudioDraftInvalid
        }
        seenSlide[slide.ID] = true
    }
    canonical, err := json.Marshal(doc)
    if err != nil || len(canonical) > maxStudioDraftBytes { return nil, ErrStudioDraftInvalid }
    return canonical, nil
}

func ReadStudioDraft(ctx context.Context, db *sql.DB) (StudioDraftRecord, error) {
    var value StudioDraftRecord
    var document []byte
    err := db.QueryRowContext(ctx,
        "SELECT template_key, document_json, version, updated_by_actor_id FROM dsh.marketing_studio_drafts WHERE template_key=$1",
        StudioTemplateKey,
    ).Scan(&value.TemplateKey, &document, &value.Version, &value.UpdatedByActorID)
    if err != nil { return StudioDraftRecord{}, err }
    value.Document = json.RawMessage(document)
    return value, nil
}

// SetStudioDraft holds the row lock through the idempotency and version
// checks. Replays return the original result, never a later mutation.
func SetStudioDraft(ctx context.Context, db *sql.DB, input json.RawMessage, expected int,
    actor, correlation, idempotency string) (StudioDraftRecord, bool, error) {
    if expected < 1 || len(strings.TrimSpace(actor)) == 0 ||
        len(correlation) < 8 || len(correlation) > 128 ||
        len(idempotency) < 8 || len(idempotency) > 128 {
        return StudioDraftRecord{}, false, ErrStudioDraftInvalid
    }
    canonical, err := ValidateStudioDocument(input)
    if err != nil { return StudioDraftRecord{}, false, ErrStudioDraftInvalid }
    requestHash := HashMarketingFacts("studio-draft:v1", string(canonical), fmt.Sprint(expected), actor)

    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return StudioDraftRecord{}, false, err }
    defer func() { _ = tx.Rollback() }()

    var currentVersion int
    var previousDocument []byte
    err = tx.QueryRowContext(ctx,
        "SELECT version, document_json FROM dsh.marketing_studio_drafts WHERE template_key=$1 FOR UPDATE",
        StudioTemplateKey,
    ).Scan(&currentVersion, &previousDocument)
    if err != nil { return StudioDraftRecord{}, false, err }

    var priorHash string
    var replayVersion int
    var replayDocument []byte
    err = tx.QueryRowContext(ctx,
        "SELECT request_hash, result_version, result_document_json FROM dsh.marketing_studio_draft_events WHERE idempotency_key=$1",
        idempotency,
    ).Scan(&priorHash, &replayVersion, &replayDocument)
    if err == nil {
        if priorHash != requestHash { return StudioDraftRecord{}, false, ErrStudioDraftConflict }
        if err := tx.Commit(); err != nil { return StudioDraftRecord{}, false, err }
        return StudioDraftRecord{TemplateKey: StudioTemplateKey, Document: json.RawMessage(replayDocument),
            Version: replayVersion, UpdatedByActorID: actor}, true, nil
    }
    if !errors.Is(err, sql.ErrNoRows) { return StudioDraftRecord{}, false, err }
    if currentVersion != expected { return StudioDraftRecord{}, false, ErrStudioDraftConflict }

    nextVersion := currentVersion + 1
    _, err = tx.ExecContext(ctx,
        "UPDATE dsh.marketing_studio_drafts SET document_json=$1::jsonb, version=$2, updated_by_actor_id=$3, updated_at=clock_timestamp() WHERE template_key=$4",
        string(canonical), nextVersion, actor, StudioTemplateKey,
    )
    if err != nil { return StudioDraftRecord{}, false, err }

    var priorValue any
    if len(previousDocument) > 0 { priorValue = string(previousDocument) }
    _, err = tx.ExecContext(ctx,
        "INSERT INTO dsh.marketing_studio_draft_events (idempotency_key, request_hash, template_key, expected_version, result_version, previous_document_json, result_document_json, acting_actor_id, correlation_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)",
        idempotency, requestHash, StudioTemplateKey, expected, nextVersion, priorValue, string(canonical), actor, correlation,
    )
    if err != nil { return StudioDraftRecord{}, false, err }
    if err := tx.Commit(); err != nil { return StudioDraftRecord{}, false, err }
    return StudioDraftRecord{TemplateKey: StudioTemplateKey, Document: canonical,
        Version: nextVersion, UpdatedByActorID: actor}, false, nil
}
