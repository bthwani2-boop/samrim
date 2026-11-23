package captainstanding

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lib/pq"
)

// Only the same dedicated disposable session-02 PostgreSQL already admitted for
// Captain-standing tests. Never connects to retained project, remote or real data.
func TestCaptainInterestIsolatedPostgresDurability(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("NOT_RUN: isolated synthetic PostgreSQL not enabled")
	}
	dsn := os.Getenv("BTHWANI_CAPTAIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: dedicated synthetic PostgreSQL URL absent")
	}
	if !isolatedCaptainTestDSN(dsn, os.Getenv("BTHWANI_CAPTAIN_TEST_CONTAINER"), os.Getenv("PGHOSTADDR")) {
		t.Fatal("refusing any non-dedicated Captain PostgreSQL destination")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var databaseName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil ||
		databaseName != "refoundation_captain_agent02" {
		t.Fatal("disposable DB identity mismatch")
	}
	suffix := make([]byte, 6)
	if _, err = rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	schema := "dsh_test_interest_" + hex.EncodeToString(suffix)
	escaped := pq.QuoteIdentifier(schema)
	if _, err = db.ExecContext(ctx, "CREATE SCHEMA "+escaped); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if _, e := db.ExecContext(cleanup, "DROP SCHEMA "+escaped+" CASCADE"); e != nil {
			t.Errorf("failed to drop only test-owned synthetic schema: %v", e)
		}
	}()
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", "011_captain_interest.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, strings.ReplaceAll(string(migration), "__SCHEMA__", schema)); err != nil {
		t.Fatal("DSH Captain interest migration failed: ", err)
	}
	repo, err := NewPostgresInterestRepository(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	svc := NewInterestService(interestIdentity{allow: true}, repo)
	candidate := InterestSubmission{Name: "محمد أحمد", Phone: "771234567", City: "صنعاء", District: "التحرير",
		VehicleType: "MOTORCYCLE", PlateRegistered: boolPtr(true), PhoneType: "SMART"}
	if err = svc.Submit(ctx, candidate); err != nil {
		t.Fatal(err)
	}
	duplicate := candidate
	duplicate.Name = "اسم بديل"
	var results [5]error
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			results[index] = svc.Submit(ctx, duplicate)
		}(i)
	}
	wg.Wait()
	for i, e := range results {
		if e != nil {
			t.Fatalf("duplicate %d failed: %v", i, e)
		}
	}
	// The public flow is not Identity admission; no standing row is created.
	reader, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	stored, err := NewPostgresInterestRepository(reader, schema)
	if err != nil {
		t.Fatal(err)
	}
	page, err := stored.List(ctx, InterestFilter{Limit: 20})
	if err != nil || len(page.Items) != 1 || page.Items[0].Name != candidate.Name ||
		page.Items[0].Phone != candidate.Phone || page.Items[0].Contacted {
		t.Fatalf("durable readback with dedupe: %+v %v", page, err)
	}
	_, err = NewInterestService(interestIdentity{allow: false}, repo).List(ctx, "operator-test-token", InterestFilter{Limit: 20})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("unpermitted operator could read personal data: %v", err)
	}
	entry, err := svc.MarkContacted(ctx, "operator-test-token", page.Items[0].ID)
	if err != nil || !entry.Contacted {
		t.Fatalf("mark contacted: %+v %v", entry, err)
	}
	again, err := svc.MarkContacted(ctx, "operator-test-token", page.Items[0].ID)
	if err != nil || !again.Contacted {
		t.Fatalf("repeat marking: %+v %v", again, err)
	}
	readback, err := stored.List(ctx, InterestFilter{Limit: 20, Contacted: boolPtr(true)})
	if err != nil || len(readback.Items) != 1 || !readback.Items[0].Contacted {
		t.Fatalf("independent durable post-contact readback: %+v %v", readback, err)
	}
	var contactedBy string
	if err = reader.QueryRowContext(ctx, "SELECT contacted_by_actor FROM "+escaped+".captain_interest WHERE id=$1",
		page.Items[0].ID).Scan(&contactedBy); err != nil || contactedBy != "operator-1" {
		t.Fatalf("contact actor audit not retained: %q %v", contactedBy, err)
	}

	// Exercise the actual HTTP envelope against the same isolated PostgreSQL,
	// including no Identity role grant and current operator-only read/mutation.
	handler := NewInterestHTTPHandler(NewInterestService(interestIdentity{allow: true}, repo))
	submission := strings.Replace(validInterestJSON, "771234567", "778888888", 1)
	accepted := interestCall(handler, http.MethodPost, CaptainInterestPath, submission, "")
	if accepted.Code != http.StatusAccepted || !strings.Contains(accepted.Body.String(), `"received":true`) {
		t.Fatalf("anonymous intake HTTP response: %d %s", accepted.Code, accepted.Body)
	}
	unauthorized := interestCall(handler, http.MethodGet, OperatorCaptainInterestPath, "", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("candidate private data accessible without bearer: %d", unauthorized.Code)
	}
	listed := interestCall(handler, http.MethodGet, OperatorCaptainInterestPath, "", "operator-test-token")
	if listed.Code != http.StatusOK {
		t.Fatalf("authorized operator HTTP read failed: %d %s", listed.Code, listed.Body)
	}
	var response InterestPage
	if err = json.Unmarshal(listed.Body.Bytes(), &response); err != nil || len(response.Items) != 2 {
		t.Fatalf("two persisted candidate HTTP rows expected: %+v %v", response, err)
	}
	var newID int64
	for _, item := range response.Items {
		if item.Phone == "778888888" {
			newID = item.ID
		}
	}
	if newID < 1 {
		t.Fatal("public form submission missing from owner-backed operator HTTP list")
	}
	marked := interestCall(handler, http.MethodPatch,
		OperatorCaptainInterestPath+"/"+strconv.FormatInt(newID, 10)+"/contact",
		`{"contacted":true}`, "operator-test-token")
	if marked.Code != http.StatusOK {
		t.Fatalf("authorized operator HTTP contact update failed: %d %s", marked.Code, marked.Body)
	}
	var persistentContact bool
	if err = reader.QueryRowContext(ctx,
		"SELECT contacted_at IS NOT NULL FROM "+escaped+".captain_interest WHERE id=$1", newID).
		Scan(&persistentContact); err != nil || !persistentContact {
		t.Fatalf("HTTP contact update missing from independent database readback: %t %v", persistentContact, err)
	}
}
func boolPtr(v bool) *bool { return &v }
