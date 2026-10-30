package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// More than 100 pending client requests must all remain reachable by Operations.
// Tied timestamps verify the stable ID tie-breaker; no shared DSH data is touched.
func TestPendingCancellationRequestsPaginationOverHundred(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("requires isolated DSH_DATABASE_URL")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 160*time.Second)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for _, statement := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('cancel-page-city','Test City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('cancel-page-vertical','Test Vertical','Test Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('cancel-page-type','cancel-page-vertical','Test Type','Test Type')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('cancel-page-store','cancel-page-partner','Proof Store','cancel-page-city','cancel-page-vertical','cancel-page-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
		} {
			if _, err := db.ExecContext(ctx, statement); err != nil {
				t.Fatal(err)
			}
		}
		for i := 0; i < 105; i++ {
			id := fmt.Sprintf("cancel-page-%03d", i)
			cartID := fmt.Sprintf("cancel-page-cart-%03d", i)
			orderID := fmt.Sprintf("cancel-page-order-%03d", i)
			if _, err := db.ExecContext(ctx,
				"INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'cancel-page-client','cancel-page-store','checked_out',1)", cartID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
				id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,
				state,total_amount_minor,currency,version,payment_method,payment_state,
				fulfillment_mode,payment_cash_amount_minor,cancellation_mode,cancellation_policy_version)
				VALUES($1,'cancel-page-client','cancel-page-store',$2,'cancel-page-city',1,
				'CREATED',1000,'YER',1,'CASH_AT_STORE','REQUIRES_COLLECTION',
				'CUSTOMER_PICKUP',1000,'OPERATIONS_ONLY',1)`, orderID, cartID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.order_cancellation_requests(
				id,order_id,client_actor_id,reason,idempotency_key,request_hash,correlation_id,created_at)
				VALUES($1,$2,'cancel-page-client','Please review the customer cancellation request',
				$3,'proof-hash',$4,'2026-10-30T00:00:00Z')`, id, orderID, "cancel-page-idem-"+id, "cancel-page-corr-"+id); err != nil {
				t.Fatal(err)
			}
		}
		cursor := ""
		seen := make(map[string]bool)
		for pageIndex := 0; pageIndex < 5; pageIndex++ {
			page, err := postgres.ListPendingCancellationRequests(ctx, db, 25, cursor)
			if err != nil {
				t.Fatalf("page %d: %v", pageIndex, err)
			}
			expected := 25
			if pageIndex == 4 {
				expected = 5
			}
			if len(page.Requests) != expected {
				t.Fatalf("page %d returned %d requests, want %d", pageIndex, len(page.Requests), expected)
			}
			for j, item := range page.Requests {
				wantID := fmt.Sprintf("cancel-page-%03d", pageIndex*25+j)
				if item.ID != wantID || item.State != "PENDING" || seen[item.ID] {
					t.Fatalf("incorrect, unauthorized, or repeated request: page=%d item=%+v wanted=%s", pageIndex, item, wantID)
				}
				seen[item.ID] = true
			}
			if pageIndex < 4 && (page.NextCursor == "" || page.NextCursor == cursor) {
				t.Fatalf("page %d has no valid continuation cursor", pageIndex)
			}
			if pageIndex == 4 && page.NextCursor != "" {
				t.Fatalf("last page offered phantom continuation: %q", page.NextCursor)
			}
			cursor = page.NextCursor
		}
		if len(seen) != 105 {
			t.Fatalf("only %d of 105 pending requests accessible", len(seen))
		}
		if _, err := postgres.ListPendingCancellationRequests(ctx, db, 25, "not-a-cursor"); !errors.Is(err, postgres.ErrCancellationRequestInvalid) {
			t.Fatalf("malformed cursor accepted: %v", err)
		}
		if _, err := postgres.ListPendingCancellationRequests(ctx, db, 25, strings.Repeat("x", 513)); !errors.Is(err, postgres.ErrCancellationRequestInvalid) {
			t.Fatalf("oversized cursor accepted: %v", err)
		}
	})
}
