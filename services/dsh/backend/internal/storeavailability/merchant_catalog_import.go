package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const catalogImportMaxRows = 5000
const catalogImportChunk = 25

var importSourceDigest = regexp.MustCompile("^[a-f0-9]{64}$")

// A run stores one confirmed CSV manifest. Only explicitly selected existing
// drafts are editable; name-only or ambiguous identities never create products.
type MerchantCatalogImportRow struct {
	Row             int    `json:"row"`
	Name            string `json:"name"`
	PriceYER        string `json:"priceYer"`
	StockUnits      string `json:"stockUnits"`
	OfferID         string `json:"offerId,omitempty"`
	ExpectedVersion int64  `json:"expectedVersion,omitempty"`
	SourceIssue     string `json:"sourceIssue,omitempty"`
}

type MerchantCatalogImportChange struct {
	SourceSHA256 string                     `json:"sourceSha256"`
	Rows         []MerchantCatalogImportRow `json:"rows"`
}

type MerchantCatalogImportOutcome struct {
	Row           int    `json:"row"`
	Status        string `json:"status"`
	Reason        string `json:"reason"`
	OfferID       string `json:"offerId,omitempty"`
	ResultVersion int64  `json:"resultVersion,omitempty"`
}

type MerchantCatalogImportResult struct {
	ActorID      string                         `json:"actorId"`
	RunID        string                         `json:"runId"`
	StoreID      string                         `json:"storeId"`
	SourceSHA256 string                         `json:"sourceSha256"`
	Total        int                            `json:"total"`
	Processed    int                            `json:"processed"`
	Offset       int                            `json:"offset"`
	Outcomes     []MerchantCatalogImportOutcome `json:"outcomes"`
}

func validateCatalogImport(runID string, change MerchantCatalogImportChange) error {
	if !operationIDRule.MatchString(runID) || !importSourceDigest.MatchString(change.SourceSHA256) ||
		len(change.Rows) < 1 || len(change.Rows) > catalogImportMaxRows {
		return ErrRegistrationInvalid
	}
	for i, row := range change.Rows {
		if row.Row != i+2 || !utf8.ValidString(row.Name) || !utf8.ValidString(row.PriceYER) ||
			!utf8.ValidString(row.StockUnits) || strings.ContainsRune(row.Name, 0) ||
			strings.ContainsRune(row.PriceYER, 0) || strings.ContainsRune(row.StockUnits, 0) ||
			len(row.Name) > 4096 || len(row.PriceYER) > 128 || len(row.StockUnits) > 128 {
			return ErrRegistrationInvalid
		}
		if row.SourceIssue != "" && (row.SourceIssue != "INVALID_ROW" || row.OfferID != "" || row.ExpectedVersion != 0) {
			return ErrRegistrationInvalid
		}
		if row.OfferID == "" {
			if row.ExpectedVersion != 0 {
				return ErrRegistrationInvalid
			}
		} else if !registrationPublicID.MatchString(row.OfferID) || row.ExpectedVersion < 1 || row.ExpectedVersion >= 9007199254740991 {
			return ErrRegistrationInvalid
		}
	}
	return nil
}

func encodeCatalogImportManifest(runID string, change MerchantCatalogImportChange) ([]byte, string, error) {
	if err := validateCatalogImport(runID, change); err != nil {
		return nil, "", err
	}
	manifest, err := json.Marshal(change)
	if err != nil || len(manifest) > 8*1024*1024 {
		return nil, "", ErrRegistrationInvalid
	}
	h := sha256.Sum256(manifest)
	return manifest, hex.EncodeToString(h[:]), nil
}

func decodeCatalogImportManifest(runID, digest string, stored []byte) (MerchantCatalogImportChange, error) {
	var change MerchantCatalogImportChange
	if len(stored) > 16*1024*1024 || json.Unmarshal(stored, &change) != nil {
		return MerchantCatalogImportChange{}, ErrStoreOwnerUnavailable
	}
	_, actual, err := encodeCatalogImportManifest(runID, change)
	if err != nil || actual != digest {
		return MerchantCatalogImportChange{}, ErrStoreOwnerUnavailable
	}
	return change, nil
}

func catalogImportRowOperation(actor, store, run string, row int) string {
	// Length-delimited fields, independent of caller supplied row content.
	data, _ := json.Marshal([]string{actor, store, run, strconv.Itoa(row)})
	sum := sha256.Sum256(data)
	return "bulk-edit-v1-" + hex.EncodeToString(sum[:])
}

func (s *MerchantStoreRegistrar) CatalogImport(ctx context.Context, token, storeID, runID string, start *MerchantCatalogImportChange, process bool, offset int) (MerchantCatalogImportResult, error) {
	actor, err := s.actor(ctx, token)
	if err != nil {
		return MerchantCatalogImportResult{}, err
	}
	if !registrationPublicID.MatchString(storeID) || !operationIDRule.MatchString(runID) || (start != nil && process) || offset < 0 || offset > catalogImportMaxRows {
		return MerchantCatalogImportResult{}, ErrRegistrationInvalid
	}
	var manifest []byte
	var digest string
	if start != nil {
		manifest, digest, err = encodeCatalogImportManifest(runID, *start)
		if err != nil {
			return MerchantCatalogImportResult{}, err
		}
	}
	tx, err := s.beginCatalogCommand(ctx, actor, storeID, "catalog_draft_edit_commands", "catalog_import_runs", "catalog_import_outcomes")
	if err != nil {
		return MerchantCatalogImportResult{}, err
	}
	defer tx.Rollback()
	var storedStore, storedDigest string
	var storedManifest []byte
	err = tx.QueryRowContext(ctx, `SELECT store_id,request_hash,manifest FROM catalog_import_runs
		WHERE actor_id=$1 AND run_id=$2`, actor, runID).Scan(&storedStore, &storedDigest, &storedManifest)
	if errors.Is(err, sql.ErrNoRows) {
		if start == nil {
			return MerchantCatalogImportResult{}, ErrStoreMissing
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO catalog_import_runs(actor_id,run_id,store_id,request_hash,manifest)
			VALUES($1,$2,$3,$4,$5::jsonb)`, actor, runID, storeID, digest, string(manifest)); err != nil {
			return MerchantCatalogImportResult{}, ErrUnknownResult
		}
		storedManifest = manifest
		storedDigest = digest
	} else if err != nil {
		return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
	} else if storedStore != storeID || (start != nil && digest != storedDigest) {
		return MerchantCatalogImportResult{}, ErrOperationConflict
	}
	change, err := decodeCatalogImportManifest(runID, storedDigest, storedManifest)
	if err != nil {
		return MerchantCatalogImportResult{}, err
	}
	result := MerchantCatalogImportResult{ActorID: actor, RunID: runID, StoreID: storeID, SourceSHA256: change.SourceSHA256, Total: len(change.Rows), Outcomes: make([]MerchantCatalogImportOutcome, 0)}
	rows, err := tx.QueryContext(ctx, `SELECT row_number,status,reason,coalesce(offer_id,''),coalesce(result_version,0)
		FROM catalog_import_outcomes WHERE actor_id=$1 AND run_id=$2 AND store_id=$3 ORDER BY row_number`, actor, runID, storeID)
	if err != nil {
		return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
	}
	for rows.Next() {
		var row MerchantCatalogImportOutcome
		if err = rows.Scan(&row.Row, &row.Status, &row.Reason, &row.OfferID, &row.ResultVersion); err != nil {
			rows.Close()
			return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
		}
		if row.Row != len(result.Outcomes)+2 || len(result.Outcomes) >= result.Total {
			rows.Close()
			return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
		}
		result.Outcomes = append(result.Outcomes, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
	}
	if process {
		offset = len(result.Outcomes)
	}
	if process && len(result.Outcomes) < result.Total {
		// PostgreSQL's same normalization is used for the manifest and the
		// current store catalog. Duplicate rows are held, never silently merged.
		duplicates := make(map[int]bool)
		d, e := tx.QueryContext(ctx, `SELECT (value->>'row')::int FROM
			(SELECT value,count(*) OVER (PARTITION BY lower(normalize(btrim(value->>'name'),NFC))) AS names,
			count(*) OVER (PARTITION BY value->>'offerId') AS offers
			FROM jsonb_array_elements($1::jsonb->'rows')) AS source
			WHERE names>1 OR (coalesce(value->>'offerId','')<>'' AND offers>1)`, string(storedManifest))
		if e != nil {
			return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
		}
		for d.Next() {
			var n int
			if e = d.Scan(&n); e != nil {
				d.Close()
				return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
			}
			duplicates[n] = true
		}
		e = d.Err()
		d.Close()
		if e != nil {
			return MerchantCatalogImportResult{}, ErrStoreOwnerUnavailable
		}
		end := min(len(result.Outcomes)+catalogImportChunk, result.Total)
		for _, row := range change.Rows[len(result.Outcomes):end] {
			out, e := s.processCatalogImportRow(ctx, tx, actor, storeID, runID, row, duplicates[row.Row])
			if e != nil {
				return MerchantCatalogImportResult{}, e
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO catalog_import_outcomes(actor_id,run_id,store_id,row_number,status,reason,offer_id,result_version)
				VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8::bigint,0))`, actor, runID, storeID, out.Row, out.Status, out.Reason, out.OfferID, out.ResultVersion); e != nil {
				return MerchantCatalogImportResult{}, ErrUnknownResult
			}
			result.Outcomes = append(result.Outcomes, out)
		}
	}
	if err = s.commitCatalogCommand(ctx, tx, token, actor); err != nil {
		return MerchantCatalogImportResult{}, err
	}
	result.Processed = len(result.Outcomes)
	if offset > result.Processed {
		offset = result.Processed
	}
	result.Offset = offset
	result.Outcomes = result.Outcomes[offset:min(offset+catalogImportChunk, result.Processed)]
	return result, nil
}

func (s *MerchantStoreRegistrar) processCatalogImportRow(ctx context.Context, tx *sql.Tx, actor, store, run string, row MerchantCatalogImportRow, duplicate bool) (MerchantCatalogImportOutcome, error) {
	out := MerchantCatalogImportOutcome{Row: row.Row, Status: "HELD", Reason: "UNSELECTED"}
	if row.SourceIssue == "INVALID_ROW" {
		out.Reason = "INVALID_VALUES"
		return out, nil
	}
	units, err := strconv.ParseInt(row.StockUnits, 10, 64)
	if err != nil || len(row.StockUnits) < 1 || len(row.StockUnits) > 10 ||
		strings.ContainsFunc(row.StockUnits, func(r rune) bool { return r < '0' || r > '9' }) {
		out.Reason = "INVALID_VALUES"
		return out, nil
	}
	input := MerchantCatalogDraftChange{OperationID: catalogImportRowOperation(actor, store, run, row.Row), Name: row.Name, PriceYER: row.PriceYER, StockUnits: units}
	if _, _, err = validateMerchantCatalogDraft(input); err != nil {
		out.Reason = "INVALID_VALUES"
		return out, nil
	}
	if duplicate {
		out.Reason = "DUPLICATE"
		return out, nil
	}
	if row.OfferID == "" {
		return out, nil
	}
	change := MerchantCatalogDraftEditChange{OperationID: input.OperationID, ExpectedVersion: row.ExpectedVersion, Name: input.Name, PriceYER: input.PriceYER, StockUnits: units}
	var count int
	var matchingID, matchingName string
	err = tx.QueryRowContext(ctx, `SELECT count(*),coalesce(min(o.id),''),coalesce(min(p.name),'') FROM offers o JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
		WHERE o.store_id=$1 AND lower(normalize(btrim(p.name),NFC))=lower(normalize(btrim($2),NFC))`, store, row.Name).Scan(&count, &matchingID, &matchingName)
	if err != nil {
		return out, ErrStoreOwnerUnavailable
	}
	if count != 1 || matchingID != row.OfferID {
		out.Reason = "AMBIGUOUS_OR_CHANGED"
		return out, nil
	}
	// This is the same edit writer as individual draft edits. A selected
	// row cannot rename its Product or change published/active records.
	change.Name = matchingName
	edited, err := editCatalogDraftTx(ctx, tx, actor, store, row.OfferID, change, true)
	switch {
	case errors.Is(err, ErrForbidden):
		out.Reason = "INELIGIBLE"
	case errors.Is(err, ErrCatalogDraftVersionConflict):
		out.Reason = "STALE_VERSION_OR_NAME"
	case errors.Is(err, ErrRegistrationInvalid):
		out.Reason = "INVALID_VALUES"
	case errors.Is(err, ErrOperationConflict):
		out.Status = "FAILED"
		out.Reason = "OPERATION_CONFLICT"
	case err != nil:
		return out, err
	default:
		out.Status = "ACCEPTED"
		out.Reason = "UPDATED"
		out.OfferID = edited.Offer.ID
		out.ResultVersion = edited.Offer.DraftVersion
	}
	return out, nil
}

func NewMerchantCatalogImportHandler(service *MerchantStoreRegistrar) (http.Handler, error) {
	if service == nil || service.identity == nil || service.grants == nil || service.grants.db == nil {
		return nil, ErrStoreOwnerUnavailable
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPut && r.Method != http.MethodPatch && r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, PUT, PATCH")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		offset := 0
		if r.Method == http.MethodGet && r.URL.RawQuery != "" {
			q, parseErr := url.ParseQuery(r.URL.RawQuery)
			if parseErr != nil {
				writeRegistrationFailure(w, ErrRegistrationInvalid)
				return
			}
			var e error
			offset, e = strconv.Atoi(q.Get("offset"))
			if e != nil || len(q) != 1 || len(q["offset"]) != 1 || offset < 0 || offset > catalogImportMaxRows || strconv.Itoa(offset) != q.Get("offset") {
				writeRegistrationFailure(w, ErrRegistrationInvalid)
				return
			}
		} else if r.URL.RawQuery != "" {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		if r.URL.ForceQuery || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeRegistrationFailure(w, ErrUnauthorized)
			return
		}
		var start *MerchantCatalogImportChange
		if r.Method == http.MethodPut {
			start = &MerchantCatalogImportChange{}
			if decodeUniqueJSON(w, r, 8*1024*1024, start) != nil {
				writeRegistrationFailure(w, ErrRegistrationInvalid)
				return
			}
		} else {
			body, e := io.ReadAll(io.LimitReader(r.Body, 1))
			if e != nil || len(body) != 0 {
				writeRegistrationFailure(w, ErrRegistrationInvalid)
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		result, err := service.CatalogImport(ctx, token, r.PathValue("storeID"), r.PathValue("runID"), start, r.Method == http.MethodPatch, offset)
		if err != nil {
			writeRegistrationFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}), nil
}
