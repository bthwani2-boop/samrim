package postgres_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestCatalogCategoryMediaLifecycleAndPartialUploadRecovery(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the isolated category media proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open DSH test PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("connect DSH test PostgreSQL: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply canonical DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical DSH schema: %v", err)
		}

		suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
		vertical := postgres.CommerceVerticalRecord{ID: "media-vertical-" + suffix, NameAr: "مجال الصور", NameEn: "Media Vertical", Active: true}
		verticalReason := "Create category media test vertical"
		verticalAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-media-vertical-" + suffix, Reason: verticalReason}
		if _, err := postgres.CreateCommerceVertical(ctx, db, vertical, "idem-media-vertical-"+suffix, postgres.HashCatalogVerticalCreateRequest(vertical, verticalReason), verticalAudit); err != nil {
			t.Fatalf("create media test vertical: %v", err)
		}
		category := postgres.CatalogCategoryRecord{ID: "media-category-" + suffix, VerticalID: vertical.ID, NameAr: "مشروبات", NameEn: "Drinks", Active: true}
		categoryReason := "Create category for media lifecycle"
		categoryAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-media-category-" + suffix, Reason: categoryReason}
		if _, err := postgres.CreateCatalogCategory(ctx, db, category, "idem-media-category-"+suffix, postgres.HashCatalogCategoryCreateRequest(category, categoryReason), categoryAudit); err != nil {
			t.Fatalf("create media test category: %v", err)
		}

		objectStore := &categoryMediaTestStore{objects: make(map[string]categoryMediaTestObject), partialOnPut: true, deleteFailures: 1}
		api := newDSHCatalogTestAPI(t, db, objectStore)

		provenance := media.Provenance{Creator: "Catalog test", SourceDescription: "Isolated category image", SourceURI: "https://example.test/source", RightsStatement: "Authorized for catalog display", RightsURI: "https://example.test/rights", RightsAttested: true}
		firstImage := categoryMediaPNG(t, 1, color.RGBA{R: 180, G: 40, B: 20, A: 255})
		partialKey := "idem-media-partial-" + suffix
		partialResponse, _, responseBody := uploadCategoryMediaViaAPI(t, api, category.ID, partialKey, "corr-media-partial-"+suffix, "Replace category image", 1, provenance, firstImage)
		if partialResponse != http.StatusServiceUnavailable || !strings.Contains(responseBody, "MEDIA_STORAGE_UNAVAILABLE") {
			t.Fatalf("partial object API response=%d body=%s, want storage unavailable", partialResponse, responseBody)
		}
		if objectStore.deleteCount() != 1 {
			t.Fatalf("partial object cleanup attempts=%d, want immediate compensation", objectStore.deleteCount())
		}
		var partialState string
		var partialAttempts int
		if err := db.QueryRowContext(ctx, "SELECT state,cleanup_attempts FROM dsh.catalog_category_media_assets WHERE idempotency_key=$1", partialKey).Scan(&partialState, &partialAttempts); err != nil {
			t.Fatalf("read partial media recovery record: %v", err)
		}
		if partialState != "failed" || partialAttempts < 2 || objectStore.objectCount() != 1 {
			t.Fatalf("partial upload record state=%s attempts=%d objects=%d; want durable failed retry and one retained object", partialState, partialAttempts, objectStore.objectCount())
		}
		secondPartialKey := "idem-media-partial-second-" + suffix
		objectStore.failNextPutWithPartialWrite()
		secondPartialStatus, _, secondPartialBody := uploadCategoryMediaViaAPI(t, api, category.ID, secondPartialKey, "corr-media-partial-second-"+suffix, "Replace category image", 1, provenance, firstImage)
		if secondPartialStatus != http.StatusServiceUnavailable || !strings.Contains(secondPartialBody, "MEDIA_STORAGE_UNAVAILABLE") {
			t.Fatalf("second partial object API response=%d body=%s, want storage unavailable", secondPartialStatus, secondPartialBody)
		}
		var secondPartialState string
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.catalog_category_media_assets WHERE idempotency_key=$1", secondPartialKey).Scan(&secondPartialState); err != nil || secondPartialState != "deleted" || objectStore.objectCount() != 1 {
			t.Fatalf("targeted cleanup state=%s error=%v objects=%d; want only the current partial object deleted", secondPartialState, err, objectStore.objectCount())
		}
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.catalog_category_media_assets WHERE idempotency_key=$1", partialKey).Scan(&partialState); err != nil || partialState != "failed" {
			t.Fatalf("unrelated failed asset state=%s error=%v; targeted cleanup must leave it for reconciliation", partialState, err)
		}
		objectStore.allowDeletes()
		if err := api.reconcile(ctx); err != nil {
			t.Fatalf("retry failed category media cleanup: %v", err)
		}
		if objectStore.objectCount() != 0 {
			t.Fatalf("reconciled partial media objects=%d, want 0", objectStore.objectCount())
		}
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.catalog_category_media_assets WHERE idempotency_key=$1", partialKey).Scan(&partialState); err != nil || partialState != "deleted" {
			t.Fatalf("partial media canonical state=%s, error=%v; want deleted", partialState, err)
		}
		categoryAfterFailure, err := postgres.ReadCatalogCategory(ctx, db, category.ID)
		if err != nil || categoryAfterFailure.Version != 1 || categoryAfterFailure.ImageURI != "" {
			t.Fatalf("failed upload changed category truth: %+v error=%v", categoryAfterFailure, err)
		}

		firstKey := "idem-media-first-" + suffix
		firstCorrelation := "corr-media-first-" + suffix
		firstStatus, first, responseBody := uploadCategoryMediaViaAPI(t, api, category.ID, firstKey, firstCorrelation, "Upload category image", 1, provenance, firstImage)
		if firstStatus != http.StatusOK || first.Version != 2 || first.ImageUri == "" {
			t.Fatalf("upload first category image API readback=%+v status=%d body=%s", first, firstStatus, responseBody)
		}
		if objectStore.objectCount() != 1 {
			t.Fatalf("first category media objects=%d, want 1", objectStore.objectCount())
		}
		firstURI := first.ImageUri
		firstReplayStatus, firstReplay, replayBody := uploadCategoryMediaViaAPI(t, api, category.ID, firstKey, firstCorrelation, "Upload category image", 1, provenance, firstImage)
		if firstReplayStatus != http.StatusOK || firstReplay.Version != 2 || firstReplay.ImageUri != firstURI || objectStore.objectCount() != 1 {
			t.Fatalf("category media replay=%+v status=%d body=%s objects=%d", firstReplay, firstReplayStatus, replayBody, objectStore.objectCount())
		}

		secondKey := "idem-media-second-" + suffix
		secondImage := categoryMediaPNG(t, 2, color.RGBA{R: 20, G: 60, B: 180, A: 255})
		secondStatus, second, secondBody := uploadCategoryMediaViaAPI(t, api, category.ID, secondKey, "corr-media-second-"+suffix, "Replace category image", 2, provenance, secondImage)
		if secondStatus != http.StatusOK || second.Version != 3 || second.ImageUri == "" || second.ImageUri == firstURI {
			t.Fatalf("replace category image API readback=%+v status=%d body=%s", second, secondStatus, secondBody)
		}
		if objectStore.objectCount() != 1 {
			t.Fatalf("replacement left %d stored objects, want only current image", objectStore.objectCount())
		}
		var activeCount, retiredCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FILTER (WHERE state='active'),count(*) FILTER (WHERE state='retired') FROM dsh.catalog_category_media_assets WHERE category_id=$1", category.ID).Scan(&activeCount, &retiredCount); err != nil || activeCount != 1 || retiredCount != 0 {
			t.Fatalf("replacement asset states active=%d retired=%d error=%v", activeCount, retiredCount, err)
		}
		var creator, sourceDescription, sourceURI, rightsStatement, rightsURI, attestedBy string
		var attestedAt sql.NullTime
		if err := db.QueryRowContext(ctx, `SELECT creator,source_description,source_uri,rights_statement,rights_uri,rights_attested_by_actor_id,rights_attested_at FROM dsh.catalog_category_media_assets WHERE category_id=$1 AND state='active'`, category.ID).Scan(&creator, &sourceDescription, &sourceURI, &rightsStatement, &rightsURI, &attestedBy, &attestedAt); err != nil {
			t.Fatalf("read active category image rights provenance: %v", err)
		}
		if creator != provenance.Creator || sourceDescription != provenance.SourceDescription || sourceURI != provenance.SourceURI || rightsStatement != provenance.RightsStatement || rightsURI != provenance.RightsURI || attestedBy != testOperatorActorID || !attestedAt.Valid {
			t.Fatalf("category image provenance was not preserved: creator=%q source=%q rights=%q actor=%q attested=%t", creator, sourceDescription, rightsStatement, attestedBy, attestedAt.Valid)
		}
		staleStatus, _, staleBody := uploadCategoryMediaViaAPI(t, api, category.ID, secondKey+"-stale", "corr-media-second-stale-"+suffix, "Replace category image", 2, provenance, secondImage)
		if staleStatus != http.StatusConflict || !strings.Contains(staleBody, "VERSION_CONFLICT") {
			t.Fatalf("stale category media replacement status=%d body=%s, want conflict", staleStatus, staleBody)
		}
		canonical, err := postgres.ReadCatalogCategory(ctx, db, category.ID)
		if err != nil || canonical.Version != 3 || canonical.ImageURI != second.ImageUri {
			t.Fatalf("final category image owner readback=%+v error=%v", canonical, err)
		}
	})
}

func uploadCategoryMediaViaAPI(t *testing.T, api *dshCatalogTestAPI, categoryID, idempotencyKey, correlationID, reason string, expectedVersion int, provenance media.Provenance, imageBytes []byte) (int, contract.CatalogCategory, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"reason": reason, "creator": provenance.Creator, "sourceDescription": provenance.SourceDescription,
		"sourceUri": provenance.SourceURI, "rightsStatement": provenance.RightsStatement, "rightsUri": provenance.RightsURI, "rightsAttested": "true",
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write category media multipart field %s: %v", name, err)
		}
	}
	file, err := writer.CreateFormFile("file", "category.png")
	if err != nil {
		t.Fatalf("create category media file part: %v", err)
	}
	if _, err := file.Write(imageBytes); err != nil {
		t.Fatalf("write category media file part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("finish category media multipart request: %v", err)
	}
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/dsh/catalog/categories/"+categoryID+"/media/upload", &body)
	request.Header.Set("Authorization", "Bearer "+catalogTestServiceToken)
	request.Header.Set("X-Acting-Actor-ID", testOperatorActorID)
	request.Header.Set("X-Correlation-ID", correlationID)
	request.Header.Set("Idempotency-Key", idempotencyKey)
	request.Header.Set("X-Expected-Version", fmt.Sprint(expectedVersion))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	api.mux.ServeHTTP(response, request)
	categoryResponse := contract.CatalogCategoryResponse{}
	if response.Code >= 200 && response.Code < 300 {
		if err := json.Unmarshal(response.Body.Bytes(), &categoryResponse); err != nil {
			t.Fatalf("decode category media API readback: %v", err)
		}
	}
	return response.Code, categoryResponse.Category, response.Body.String()
}

func categoryMediaPNG(t *testing.T, width int, fill color.RGBA) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, width, 1))
	for x := 0; x < width; x++ {
		picture.SetRGBA(x, 0, fill)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatalf("encode isolated category image fixture: %v", err)
	}
	return encoded.Bytes()
}

type categoryMediaTestObject struct {
	data        []byte
	contentType string
}

type categoryMediaTestStore struct {
	mu             sync.Mutex
	objects        map[string]categoryMediaTestObject
	partialOnPut   bool
	deleteFailures int
	deleteAttempts int
}

func (s *categoryMediaTestStore) EnsureBucket(context.Context) error { return nil }

func (s *categoryMediaTestStore) Put(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.objects[key] = categoryMediaTestObject{data: data, contentType: contentType}
	partial := s.partialOnPut
	s.partialOnPut = false
	s.mu.Unlock()
	if int64(len(data)) != size {
		return fmt.Errorf("object byte count %d does not match request size %d", len(data), size)
	}
	if partial {
		return errors.New("object store returned an error after writing bytes")
	}
	return nil
}

func (s *categoryMediaTestStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteAttempts++
	if s.deleteFailures > 0 {
		s.deleteFailures--
		return errors.New("temporary object deletion failure")
	}
	delete(s.objects, key)
	return nil
}

func (s *categoryMediaTestStore) Get(_ context.Context, key string) (*media.Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	object, ok := s.objects[key]
	if !ok {
		return nil, media.ErrObjectNotFound
	}
	return &media.Object{ReadCloser: io.NopCloser(bytes.NewReader(object.data)), Info: media.ObjectInfo{ContentType: object.contentType, Size: int64(len(object.data))}}, nil
}

func (s *categoryMediaTestStore) PublicURL(key string) string {
	return "https://media.example.test/" + key
}

func (s *categoryMediaTestStore) deleteCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deleteAttempts
}

func (s *categoryMediaTestStore) objectCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.objects)
}

func (s *categoryMediaTestStore) allowDeletes() {
	s.mu.Lock()
	s.deleteFailures = 0
	s.mu.Unlock()
}

func (s *categoryMediaTestStore) failNextPutWithPartialWrite() {
	s.mu.Lock()
	s.partialOnPut = true
	s.mu.Unlock()
}
