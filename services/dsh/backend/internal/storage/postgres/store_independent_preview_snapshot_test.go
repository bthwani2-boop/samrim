package postgres

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// This guards the ownership boundary at source level. The real SQL execution
// path is additionally exercised by TestIndependentDirectOrderIsolatedPersistenceGuards
// when the separately authorized disposable PostgreSQL QA is available.
func TestIndependentOwnerPreviewNeverReadsCatalogOutsideAuthorizedSnapshot(t *testing.T) {
	if _, _, _, err := ReadIndependentPreviewSnapshotForOwner(
		context.Background(), nil, "store-a", "owner-a", 20, ""); !errors.Is(err, ErrStoreNotFound) {
		t.Fatalf("missing canonical DSH owner storage must fail closed: %v", err)
	}
	read := func(path string) string {
		t.Helper()
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	storeReader := read("store_independent_preview.go")
	service := read("../../storeaccess/independent_preview.go")
	catalog := read("catalog_offer_page.go")
	publication := read("independent_storefront.go")
	for _, expected := range []string{
		"db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})",
		"readIndependentStoreOwnedByPartnerWithQueryer(ctx, tx, storeID, partnerActorID)",
		"independentStorePublicationForOwnerWithQueryer(ctx, tx, store.ID, partnerActorID)",
		"listCatalogOfferPageWithQueryer(ctx, tx, store.ID, limit, cursor)",
		"tx.Commit()",
		"readStoreProfileMediaWithQuery(ctx, queryer, \"\", store.ID, \"primary\")",
		"readStoreProfileMediaWithQuery(ctx, queryer, \"\", store.ID, \"cover\")",
		"partner_actor_id=$2 AND relation_model='INDEPENDENT_STORE'",
	} {
		if !strings.Contains(storeReader, expected) {
			t.Errorf("owner-scoped preview lost same-snapshot guard %q", expected)
		}
	}
	if !strings.Contains(service, "postgres.ReadIndependentPreviewSnapshotForOwner(") ||
		strings.Contains(service, "postgres.ListCatalogOfferPage(") ||
		strings.Contains(service, "postgres.ReadIndependentStoreOwnedByPartner(") {
		t.Fatal("private preview service must not re-read Store Catalog outside owner-scoped snapshot")
	}
	if !strings.Contains(catalog, "queryer.QueryContext(ctx, query, args...)") ||
		!strings.Contains(catalog, "hydrateCatalogOfferPage(ctx, queryer, page.Offers)") ||
		!strings.Contains(publication, "queryer.QueryRowContext(ctx, `SELECT COALESCE(publication.state") {
		t.Fatal("Store publication and Catalog/Offer media must use the caller's same transaction")
	}
}
