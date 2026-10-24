package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestMarketingConsentDefaultsDenyAndWithdrawalPreventsStaleOptIn(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated PostgreSQL connection required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		can := func(actor, channel string) bool {
			t.Helper()
			allowed, err := postgres.CanSendPromotionalContact(ctx, db, actor, channel)
			if err != nil {
				t.Fatal(err)
			}
			return allowed
		}
		if can("client-a", "PUSH") || can("client-b", "PUSH") || can("client-a", "SMS") {
			t.Fatal("absent marketing consent must deny all promotional contact")
		}
		input := postgres.MarketingConsentChange{
			ClientActorID: "client-a", Channel: "PUSH", Purpose: "PROMOTIONS",
			Decision: "OPTED_IN", Source: "CUSTOMER_APP", ExpectedVersion: 0,
			IdempotencyKey: "marketing-consent-a-first",
		}
		granted, err := postgres.ChangePromotionalContactConsent(ctx, db, input)
		if err != nil || granted.Replay || granted.Version != 1 || !can("client-a", "PUSH") {
			t.Fatalf("first grant invalid: %+v %v", granted, err)
		}
		replay, err := postgres.ChangePromotionalContactConsent(ctx, db, input)
		if err != nil || !replay.Replay || replay.Version != granted.Version {
			t.Fatalf("retry duplicated grant: %+v %v", replay, err)
		}
		malformed := input
		malformed.Decision = "OPTED_OUT"
		_, err = postgres.ChangePromotionalContactConsent(ctx, db, malformed)
		if !errors.Is(err, postgres.ErrMarketingConsentConflict) {
			t.Fatalf("reused key changed semantics: %v", err)
		}
		withdraw := input
		withdraw.Decision = "OPTED_OUT"
		withdraw.IdempotencyKey = "marketing-consent-withdraw"
		withdraw.ExpectedVersion = 0 // stale/no readback: withdrawals still win
		revoked, err := postgres.ChangePromotionalContactConsent(ctx, db, withdraw)
		if err != nil || revoked.Version != 2 || can("client-a", "PUSH") {
			t.Fatalf("stale withdrawal failed to deny: %+v %v", revoked, err)
		}
		stale := input
		stale.IdempotencyKey = "marketing-consent-stale-in"
		stale.ExpectedVersion = 1
		_, err = postgres.ChangePromotionalContactConsent(ctx, db, stale)
		if !errors.Is(err, postgres.ErrMarketingConsentConflict) || can("client-a", "PUSH") {
			t.Fatalf("old grant resurrected after opt-out: %v", err)
		}
		if can("client-b", "PUSH") || can("client-a", "EMAIL") {
			t.Fatal("marketing consent leaked to actor or channel")
		}
		newGrant := input
		newGrant.IdempotencyKey = "marketing-consent-current-in"
		newGrant.ExpectedVersion = 2
		refreshed, err := postgres.ChangePromotionalContactConsent(ctx, db, newGrant)
		if err != nil || refreshed.Version != 3 || !can("client-a", "PUSH") {
			t.Fatalf("fresh deliberate opt-in not honored: %+v %v", refreshed, err)
		}
		var events int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.customer_marketing_consent_events WHERE client_actor_id='client-a'").Scan(&events); err != nil {
			t.Fatal(err)
		}
		if events != 3 {
			t.Fatalf("expected immutable 3 decision events, got %d", events)
		}
		var state, source string
		if err := db.QueryRowContext(ctx, "SELECT decision,source FROM dsh.customer_marketing_consent_events WHERE client_actor_id='client-a' AND result_version=2").Scan(&state, &source); err != nil {
			t.Fatal(err)
		}
		if state != "OPTED_OUT" || source != "CUSTOMER_APP" {
			t.Fatalf("withdrawal audit lost: %s %s", state, source)
		}
	})
}
