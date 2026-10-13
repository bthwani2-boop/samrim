package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperatorRegistryUpgradePreservesRowsAndUniquePartnerJoiningFacts(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated operator registry upgrade proof")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := applyMigrationPrefix(ctx, db, records, scripts, 120); err != nil {
			t.Fatal(err)
		}
		employee, err := hr.Create(ctx, db, hr.CreateInput{FullNameAr: "موظف ترقية السجل", Department: "العمليات", JobTitle: "موظف", StartDate: "2026-10-01", WorkLocation: "صنعاء"}, "registry-proof", "registry-upgrade-employee", "registry-employee")
		if err != nil {
			t.Fatal(err)
		}
		beforeEmployee, err := hr.Read(ctx, db, employee.Employee.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []string{"registry-a", "registry-b", "registry-c"} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: id, PartnerActorID: "registry-partner", Name: id})
		}
		// The canonical unique partner index permits one joining case per partner.
		// Three stores must remain three rows, all using that partner's facts.
		_, err = db.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,first_store_vertical_id,first_store_commercial_type_id,partner_actor_id,state,store_id,origin,owner_full_name)
		VALUES('case-owner','+967770000103','مؤسسة الاختبار','متجر الاختبار','registry-a-vertical','registry-a-type','registry-partner','draft','registry-a','control_panel','مالك المتاجر')`)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,partner_actor_id,origin,owner_full_name) VALUES('case-unlinked','+967770000104','طلب مستقل','متجر مستقل','unrelated-partner','control_panel','طلب غير مرتبط')`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,partner_actor_id,origin) VALUES('case-duplicate','+967770000105','طلب مكرر','متجر مكرر','registry-partner','control_panel')`); err == nil {
			t.Fatal("canonical joining owner uniqueness was lost")
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET updated_at='2026-10-01T00:00:00Z' WHERE partner_actor_id='registry-partner'`); err != nil {
			t.Fatal(err)
		}
		before, err := postgres.ListStoresForPartnerActor(ctx, db, "registry-partner", 10, "")
		if err != nil {
			t.Fatal(err)
		}
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		after, err := postgres.ListStoresForPartnerActor(ctx, db, "registry-partner", 10, "")
		if err != nil || !reflect.DeepEqual(before, after) {
			t.Fatalf("upgrade changed stores: %v", err)
		}
		afterEmployee, err := hr.Read(ctx, db, beforeEmployee.ID)
		if err != nil || !reflect.DeepEqual(beforeEmployee, afterEmployee) {
			t.Fatalf("upgrade changed employee: %v", err)
		}
		if err := postgres.VerifyOperationalReadiness(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		for _, sort := range []string{"updated_asc", "updated_desc"} {
			ids := []string{}
			cursor := ""
			for {
				page, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", sort, 1, cursor)
				if err != nil {
					t.Fatal(err)
				}
				for _, store := range page.Stores {
					ids = append(ids, store.ID)
					want := "مالك المتاجر"
					if store.PartnerName != want {
						t.Fatalf("%s received another partner's owner: %q, want %q", store.ID, store.PartnerName, want)
					}
					display := postgres.StoreRecord{ID: store.ID}
					if err := postgres.ReadStoreDisplayNames(ctx, db, &display); err != nil || display.PartnerName != want {
						t.Fatalf("detail and registry disagree: %+v %v", display, err)
					}
				}
				if page.NextCursor == "" {
					break
				}
				if len(ids) > 3 || page.NextCursor == cursor {
					t.Fatal("cursor duplicated or failed to progress")
				}
				cursor = page.NextCursor
			}
			want := []string{"registry-a", "registry-b", "registry-c"}
			if sort == "updated_desc" {
				want = []string{"registry-c", "registry-b", "registry-a"}
			}
			if !reflect.DeepEqual(ids, want) {
				t.Fatalf("keyset traversal %s: %v, want %v", sort, ids, want)
			}
		}
		for _, query := range []string{"+967770000103", "مالك المتاجر"} {
			page, err := postgres.ListStoresForOperator(ctx, db, "", query, "", "contains", "updated_desc", 10, "")
			if err != nil || len(page.Stores) != 3 {
				t.Fatalf("partner-scoped store search %q: %+v %v", query, page, err)
			}
		}
		page, err := postgres.ListStoresForOperator(ctx, db, "", "+967770000104", "", "contains", "updated_desc", 10, "")
		if err != nil || len(page.Stores) != 0 {
			t.Fatalf("unlinked intake leaked into store search: %+v %v", page, err)
		}
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade replay: %v", err)
		}
		// Bulk fixtures belong only to this disposable database; exercise the
		// actual SQL across 10,000 stores and independent onboarding owners.
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(id,partner_actor_id,name,primary_vertical_id,commercial_store_type_id,updated_at)
		SELECT 'volume-' || lpad(n::text,5,'0'),'volume-partner-' || n,'متجر الحجم ' || n,'registry-a-vertical','registry-a-type','2026-10-02T00:00:00Z'::timestamptz FROM generate_series(1,10000) n`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,partner_actor_id,origin,owner_full_name)
		SELECT 'volume-case-' || n,'+967' || lpad(n::text,9,'0'),'مؤسسة الحجم','متجر الحجم','volume-partner-' || n,'control_panel','مالك الحجم ' || n FROM generate_series(1,10000) n`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `ANALYZE dsh.stores; ANALYZE dsh.joining_cases`); err != nil {
			t.Fatal(err)
		}
		started := time.Now()
		volumePage, err := postgres.ListStoresForOperator(ctx, db, "", "مالك الحجم 10000", "", "contains", "updated_desc", 10, "")
		if err != nil || len(volumePage.Stores) != 1 || volumePage.Stores[0].ID != "volume-10000" {
			t.Fatalf("10,000-owner search: %+v %v", volumePage, err)
		}
		if elapsed := time.Since(started); elapsed > 2*time.Second {
			t.Fatalf("bounded registry search took %s", elapsed)
		} else {
			t.Logf("10,000-owner search: %s", elapsed)
		}
		seen := map[string]bool{}
		cursor := ""
		for {
			page, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 100, cursor)
			if err != nil {
				t.Fatal(err)
			}
			for _, store := range page.Stores {
				if seen[store.ID] {
					t.Fatalf("duplicate store across volume pages: %s", store.ID)
				}
				seen[store.ID] = true
			}
			if page.NextCursor == "" {
				break
			}
			if page.NextCursor == cursor {
				t.Fatal("volume cursor failed to progress")
			}
			cursor = page.NextCursor
		}
		if len(seen) != 10003 {
			t.Fatalf("volume traversal lost rows: %d, want 10003", len(seen))
		}
	})
}
