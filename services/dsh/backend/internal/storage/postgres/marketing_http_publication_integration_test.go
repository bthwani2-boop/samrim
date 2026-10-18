package postgres_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
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
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
	_ "github.com/lib/pq"
)

type marketingTestMedia struct{ data map[string][]byte }

func (m *marketingTestMedia) EnsureBucket(context.Context) error { return nil }
func (m *marketingTestMedia) Put(_ context.Context, key string, source io.Reader, n int64, _ string) error {
	data, err := io.ReadAll(source)
	if err == nil && int64(len(data)) != n {
		return fmt.Errorf("media size mismatch")
	}
	if err == nil {
		m.data[key] = data
	}
	return err
}
func (m *marketingTestMedia) Delete(_ context.Context, key string) error {
	delete(m.data, key)
	return nil
}
func (m *marketingTestMedia) Get(context.Context, string) (*media.Object, error) {
	return nil, media.ErrObjectNotFound
}
func (m *marketingTestMedia) PublicURL(key string) string {
	return "https://assets.example.invalid/" + key
}

func TestOperatorHTTPImageUploadPublishAndPauseReachesPublicFeed(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city = "http-publication-city"
		const actor = "http-marketing-operator"
		const serviceToken = "ssssssssssssssssssssssss"
		const identityToken = "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"
		const contentID = "content-http-marketing-proof"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
			t.Fatal(err)
		}
		identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+identityToken {
				http.Error(w, "unauthorized", 401)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			switch {
			case strings.HasSuffix(r.URL.Path, "/roles/operator"):
				_, _ = fmt.Fprintf(w, `{"actorId":%q,"role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`, actor)
			case strings.HasSuffix(r.URL.Path, "/permissions/marketing"):
				_, _ = fmt.Fprintf(w, `{"actorId":%q,"permission":"marketing","enabled":true,"version":1}`, actor)
			default:
				http.NotFound(w, r)
			}
		}))
		defer identityServer.Close()
		endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identityClient, err := identityintegration.New(endpoint, identityToken)
		if err != nil {
			t.Fatal(err)
		}
		images := &marketingTestMedia{data: make(map[string][]byte)}
		server, err := transporthttp.NewMarketingWithDependencies(identityClient, serviceToken, db, images)
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		server.Register(mux)
		request := func(method, path string, body io.Reader, contentType, idempotency string, version int) *httptest.ResponseRecorder {
			t.Helper()
			r := httptest.NewRequestWithContext(ctx, method, path, body)
			r.Header.Set("Authorization", "Bearer "+serviceToken)
			r.Header.Set("X-Acting-Actor-ID", actor)
			r.Header.Set("X-Correlation-ID", "corr-http-marketing-proof")
			r.Header.Set("Idempotency-Key", idempotency)
			if contentType != "" {
				r.Header.Set("Content-Type", contentType)
			}
			if version > 0 {
				r.Header.Set("X-Expected-Version", fmt.Sprint(version))
			}
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			return w
		}
		pixels := image.NewRGBA(image.Rect(0, 0, 64, 64))
		for y := 0; y < 64; y++ {
			for x := 0; x < 64; x++ {
				pixels.Set(x, y, color.RGBA{R: 240, G: 120, B: 40, A: 255})
			}
		}
		var pngData bytes.Buffer
		if err := png.Encode(&pngData, pixels); err != nil {
			t.Fatal(err)
		}
		var upload bytes.Buffer
		multipartWriter := multipart.NewWriter(&upload)
		for key, value := range map[string]string{
			"id": contentID, "kind": "BANNER", "titleAr": "اختبار النشر عبر API",
			"targetType": "INFO", "serviceCityId": city, "ordinal": "0",
			"startsAt": time.Now().UTC().Add(-time.Minute).Format(time.RFC3339),
			"creator":  "Test Creator", "sourceDescription": "Test-owned generated PNG image",
			"rightsStatement": "Generated and approved for isolated integration test", "rightsAttested": "true",
		} {
			if err := multipartWriter.WriteField(key, value); err != nil {
				t.Fatal(err)
			}
		}
		imagePart, err := multipartWriter.CreateFormFile("file", "proof.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := imagePart.Write(pngData.Bytes()); err != nil {
			t.Fatal(err)
		}
		if err := multipartWriter.Close(); err != nil {
			t.Fatal(err)
		}
		uploaded := request("POST", "/dsh/operator/discovery-content", bytes.NewReader(upload.Bytes()), multipartWriter.FormDataContentType(), "idem-http-create", 0)
		if uploaded.Code != http.StatusCreated {
			t.Fatalf("HTTP create status=%d body=%s", uploaded.Code, uploaded.Body.String())
		}
		var created struct {
			Content struct {
				ID, State, MediaUri string
				Version             int
			}
		}
		if err := json.Unmarshal(uploaded.Body.Bytes(), &created); err != nil {
			t.Fatal(err)
		}
		if created.Content.ID != contentID || created.Content.State != "DRAFT" || created.Content.Version != 1 || created.Content.MediaUri == "" || len(images.data) != 1 {
			t.Fatalf("creation readback: %+v media=%d", created, len(images.data))
		}
		replay := request("POST", "/dsh/operator/discovery-content", bytes.NewReader(upload.Bytes()), multipartWriter.FormDataContentType(), "idem-http-create", 0)
		if replay.Code != http.StatusOK || len(images.data) != 1 {
			t.Fatalf("HTTP create retry=%d body=%s", replay.Code, replay.Body.String())
		}
		publicPath := "/dsh/public/discovery-content?serviceCityId=" + city
		visible := func(want bool, stage string) {
			t.Helper()
			w := request("GET", publicPath, nil, "", "", 0)
			if w.Code != http.StatusOK {
				t.Fatalf("%s: GET public=%d %s", stage, w.Code, w.Body.String())
			}
			var response struct{ Items []struct{ ID string } }
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range response.Items {
				found = found || item.ID == contentID
			}
			if found != want {
				t.Fatalf("%s: public visible=%v expected=%v", stage, found, want)
			}
		}
		visible(false, "draft")
		publication := func(state, key string, version int) *httptest.ResponseRecorder {
			return request("POST", "/dsh/operator/discovery-content/"+contentID+"/publication", strings.NewReader(fmt.Sprintf(`{"state":%q}`, state)), "application/json", key, version)
		}
		published := publication("PUBLISHED", "idem-http-publish", 1)
		if published.Code != http.StatusCreated && published.Code != http.StatusOK {
			t.Fatalf("publish=%d %s", published.Code, published.Body.String())
		}
		visible(true, "published")
		stale := publication("PAUSED", "idem-http-stale-pause", 1)
		if stale.Code != http.StatusConflict {
			t.Fatalf("stale expected 409, got %d %s", stale.Code, stale.Body.String())
		}
		paused := publication("PAUSED", "idem-http-pause", 2)
		if paused.Code != http.StatusCreated && paused.Code != http.StatusOK {
			t.Fatalf("pause=%d %s", paused.Code, paused.Body.String())
		}
		visible(false, "paused")
		stored, err := postgres.ReadDiscoveryContent(ctx, db, contentID)
		if err != nil || stored.State != "PAUSED" || stored.Version != 3 {
			t.Fatalf("paused canonical readback: %+v err=%v", stored, err)
		}
		if len(images.data) != 1 {
			t.Fatalf("media lost on pause: %d", len(images.data))
		}
	})
}
