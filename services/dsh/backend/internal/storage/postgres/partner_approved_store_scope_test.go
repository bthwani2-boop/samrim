package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// An approved owner's unpublished Store is accessible from the Partner app.
// Approval is not publication; an unrelated Partner must see neither Store.
func TestPartnerApprovedUnpublishedStoreRemainsOwnerScoped(t *testing.T) {
	databaseURL := os.Getenv("DSH_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the isolated Partner Store readback proof")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })

	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const owner = "approved-partner-owner"
		const stranger = "another-partner-owner"
		const unpublished = "store-approved-unpublished"
		const other = "store-foreign-unpublished"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: unpublished, PartnerActorID: owner,
			Name: "متجر معتمد غير منشور", PublicationState: "unpublished",
		})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: other, PartnerActorID: stranger,
			Name: "متجر شريك آخر", PublicationState: "unpublished",
		})

		ownerPage, err := postgres.ListPartnerAccessibleStores(ctx, db, owner, 25, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(ownerPage.Stores) != 1 || ownerPage.NextCursor != "" {
			t.Fatalf("owned approved Store readback is not isolated: %+v", ownerPage)
		}
		ownStore := ownerPage.Stores[0]
		if ownStore.ID != unpublished || !ownStore.Owned || ownStore.PublicationState != "unpublished" {
			t.Fatalf("approved unpublished Store was unavailable or incorrectly presented: %+v", ownStore)
		}
		if len(ownStore.Permissions) == 0 {
			t.Fatalf("canonical Store owner lost operational permissions: %+v", ownStore)
		}

		strangerPage, err := postgres.ListPartnerAccessibleStores(ctx, db, stranger, 25, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(strangerPage.Stores) != 1 || strangerPage.Stores[0].ID != other || !strangerPage.Stores[0].Owned {
			t.Fatalf("foreign Store leaked into another Partner workspace: %+v", strangerPage)
		}
		unrelatedPage, err := postgres.ListPartnerAccessibleStores(ctx, db, "unrelated-partner", 25, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(unrelatedPage.Stores) != 0 || unrelatedPage.NextCursor != "" {
			t.Fatalf("unrelated Partner must see no Stores: %+v", unrelatedPage)
		}
	})
}
