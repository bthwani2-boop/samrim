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

func TestStorePublicContactOptInOwnershipAndIdempotency(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		_, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('contact-city','Test City',true)")
		if err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "contact-a", PartnerActorID: "owner-a", Name: "Store A", ServiceCityID: "contact-city", PublicationState: "published"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "contact-b", PartnerActorID: "owner-b", Name: "Store B", ServiceCityID: "contact-city"})
		empty, err := postgres.ReadStorePublicContactForOwner(ctx, db, "contact-a", "owner-a")
		if err != nil || empty.Version != 0 || empty.PhoneE164 != "" {
			t.Fatalf("no contact may be derived from private onboarding data: %+v, %v", empty, err)
		}
		if _, err := postgres.ReadStorePublicContactForOwner(ctx, db, "contact-a", "owner-b"); !errors.Is(err, postgres.ErrStorePublicContactForbidden) {
			t.Fatalf("foreign Store read must be forbidden: %v", err)
		}
		input := postgres.StorePublicContactInput{PhoneE164: "+967712345678", Email: "public@example.com", WhatsAppPhoneE164: "+967734567890", WhatsAppEnabled: true, ExpectedVersion: 0}
		saved, replay, err := postgres.UpdateStorePublicContactForOwner(ctx, db, "contact-a", "owner-a", input, "contact-idempotency-a", "contact-correlation-a")
		if err != nil || replay || saved.Version != 1 {
			t.Fatalf("first commit: %+v replay=%v err=%v", saved, replay, err)
		}
		again, replay, err := postgres.UpdateStorePublicContactForOwner(ctx, db, "contact-a", "owner-a", input, "contact-idempotency-a", "contact-correlation-a")
		if err != nil || !replay || again.Version != 1 {
			t.Fatalf("idempotent replay: %+v replay=%v err=%v", again, replay, err)
		}
		changedInput := input
		changedInput.Email = "changed@example.com"
		if _, _, err := postgres.UpdateStorePublicContactForOwner(ctx, db, "contact-a", "owner-a", changedInput, "contact-idempotency-a", "contact-correlation-a"); !errors.Is(err, postgres.ErrStorePublicContactIdempotency) {
			t.Fatalf("same key with different contact facts must conflict: %v", err)
		}
		if _, _, err := postgres.UpdateStorePublicContactForOwner(ctx, db, "contact-a", "owner-a", input, "contact-idempotency-stale", "contact-correlation-stale"); !errors.Is(err, postgres.ErrStorePublicContactVersion) {
			t.Fatalf("stale version must conflict: %v", err)
		}
		if _, _, err := postgres.UpdateStorePublicContactForOwner(ctx, db, "contact-a", "owner-b", input, "contact-idempotency-b", "contact-correlation-b"); !errors.Is(err, postgres.ErrStorePublicContactForbidden) {
			t.Fatalf("cross-owner write must fail closed: %v", err)
		}
		public, err := postgres.ReadPublishedStorePublicContact(ctx, db, "contact-a")
		if err != nil || public.WhatsAppPhoneE164 != "+967734567890" || !public.WhatsAppEnabled {
			t.Fatalf("published opt-in contact: %+v, %v", public, err)
		}
		if _, err := postgres.ReadPublishedStorePublicContact(ctx, db, "contact-b"); !errors.Is(err, postgres.ErrStorePublicContactNotFound) {
			t.Fatalf("unpublished contact must be hidden: %v", err)
		}
		disabled := input
		disabled.ExpectedVersion = saved.Version
		disabled.WhatsAppEnabled = false
		if _, _, err := postgres.UpdateStorePublicContactForOwner(ctx, db, "contact-a", "owner-a", disabled, "contact-idempotency-disable", "contact-correlation-disable"); err != nil {
			t.Fatal(err)
		}
		public, err = postgres.ReadPublishedStorePublicContact(ctx, db, "contact-a")
		if err != nil || public.WhatsAppPhoneE164 != "" || public.WhatsAppEnabled {
			t.Fatalf("disabled WhatsApp must not leak: %+v, %v", public, err)
		}
		var auditCount int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.store_public_contact_audit WHERE store_id='contact-a'").Scan(&auditCount); err != nil || auditCount != 2 {
			t.Fatalf("contact audit not attributable: count=%d err=%v", auditCount, err)
		}
	})
}
