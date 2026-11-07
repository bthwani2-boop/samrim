package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Exercises the canonical DSH joining writer and keyset queue over 200 distinct
// applicant/phone bindings. Identity OTP, WLT, Operator human decisions and
// whole-platform daily throughput are deliberately outside this database proof.
func TestSelfService200ApplicationsAndOperatorQueuePagination(t *testing.T) {
	raw := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if raw == "" {
		t.Skip("dedicated joining QA database is not configured")
	}
	if !joiningQADatabaseIsolated(raw, os.Getenv) {
		t.Fatal("refusing non-isolated joining database")
	}
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, raw, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		for _, query := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('qa-batch-city','QA City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('qa-batch-vertical','QA Vertical','QA Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('qa-batch-type','qa-batch-vertical','QA Shop','QA Shop')",
		} {
			if _, err := db.ExecContext(ctx, query); err != nil {
				t.Fatal(err)
			}
		}
		keys, err := postgres.NewJoiningCaseEvidenceKeyring("qa-v1", map[string]string{
			"qa-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
		})
		if err != nil {
			t.Fatal(err)
		}
		const count = 200
		const maxWorkers = 8
		db.SetMaxOpenConns(maxWorkers)
		expected := make(map[string]struct{}, count)
		var expectedMu sync.Mutex
		errorsFound := make(chan error, count)
		work := make(chan int)
		var workers sync.WaitGroup
		start := time.Now()
		for worker := 0; worker < maxWorkers; worker++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for i := range work {
					phone := fmt.Sprintf("+967777%06d", i)
					actor := fmt.Sprintf("qa-batch-applicant-%03d", i)
					request := postgres.JoiningCaseRequest{
						Phone: phone, OwnerFullName: "Synthetic Partner", BusinessName: fmt.Sprintf("Synthetic Business %d", i),
						FirstStoreName: fmt.Sprintf("Synthetic Store %d", i), FirstStoreAddress: "Isolated QA address",
						FirstStoreWorkingHours: json.RawMessage(`{"intervals":[]}`),
						FirstStoreProofType:    "IDENTITY_DOCUMENT", FirstStoreProofNumber: "SYNTHETIC-ONLY",
						ServiceCityID: "qa-batch-city", VerticalID: "qa-batch-vertical", CommercialTypeID: "qa-batch-type",
						Latitude: 15.36, Longitude: 44.20, FulfillmentModes: []string{"BTHWANI_CAPTAIN"},
					}
					result, err := postgres.CreateSelfServiceJoiningCase(ctx, db, postgres.CreateJoiningCaseInput{
						Request: request, ActingActorID: actor, EvidenceKeyring: keys,
						IdempotencyKey: fmt.Sprintf("qa-batch-create-%03d", i),
						CorrelationID:  fmt.Sprintf("qa-batch-correlation-%03d", i),
						RequestHash:    postgres.HashJoiningCaseRequest(request),
					})
					if err != nil || result.Replayed || result.Case.State != "draft" {
						errorsFound <- fmt.Errorf("case %d creation state=%q replay=%v err=%v", i, result.Case.State, result.Replayed, err)
						continue
					}
					expectedMu.Lock()
					_, duplicate := expected[result.Case.ID]
					expected[result.Case.ID] = struct{}{}
					expectedMu.Unlock()
					if duplicate {
						errorsFound <- fmt.Errorf("case ID reused for index %d", i)
					}
					if i == 0 {
						denied, readErr := postgres.ReadSelfServiceJoiningCase(ctx, db, "qa-other-account", phone)
						if !errors.Is(readErr, postgres.ErrJoiningCaseNotFound) || denied.Case.ID != "" {
							errorsFound <- fmt.Errorf("different actor read an application: %v", readErr)
						}
					}
				}
			}()
		}
		for i := 0; i < count; i++ {
			work <- i
		}
		close(work)
		workers.Wait()
		close(errorsFound)
		if len(errorsFound) > 0 {
			t.Fatal(<-errorsFound)
		}
		createDuration := time.Since(start)
		seen := make(map[string]struct{}, count)
		cursor := ""
		pages := 0
		for {
			page, err := postgres.ListJoiningCases(ctx, db, "draft", "", "created_desc", 50, cursor)
			if err != nil {
				t.Fatal(err)
			}
			pages++
			if len(page.Cases) == 0 || len(page.Cases) > 50 {
				t.Fatalf("unexpected queue page size %d", len(page.Cases))
			}
			for _, item := range page.Cases {
				if _, exists := expected[item.ID]; !exists {
					t.Fatal("queue returned unknown case")
				}
				if _, duplicate := seen[item.ID]; duplicate {
					t.Fatal("queue repeated a case across pages")
				}
				seen[item.ID] = struct{}{}
			}
			if page.NextCursor == "" {
				break
			}
			if page.NextCursor == cursor || pages >= 6 {
				t.Fatal("operator queue cursor stalled")
			}
			cursor = page.NextCursor
		}
		if pages != 4 || len(seen) != count {
			t.Fatalf("queue lost cases: pages=%d seen=%d want=%d", pages, len(seen), count)
		}
		t.Logf("DSH database-only 200-application write=%s, queue pages=%d (not an end-to-end capacity SLA)", createDuration, pages)
	}, 7*time.Minute)
}
