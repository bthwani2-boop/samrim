package postgres_test

import (
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"strings"
)

func (s *catalogRefoundationScenario) verifyShoppingShortcutDiscovery() {
	s.t.Helper()
	reason := "Configure simple public shopping shortcuts"
	typeOnly := postgres.ShoppingShortcutInput{VerticalID: s.verticalID, TitleAr: "نوع المتجر الأول", Ordinal: 1, Active: true, StoreTypeIDs: []string{"store_catalog_v1-type"}}
	key := "idempotency-shopping-shortcut-type"
	result, err := postgres.MutateShoppingShortcut(s.ctx, s.db, typeOnly, key, postgres.HashShoppingShortcutMutation(typeOnly, reason), closureAudit("correlation-shopping-shortcut-type", reason))
	if err != nil {
		s.t.Fatalf("create Store-type shortcut: %v", err)
	}
	replay, err := postgres.MutateShoppingShortcut(s.ctx, s.db, typeOnly, key, postgres.HashShoppingShortcutMutation(typeOnly, reason), closureAudit("correlation-shopping-shortcut-type", reason))
	if err != nil || !replay.Replayed || replay.Shortcut.ID != result.Shortcut.ID {
		s.t.Fatalf("shortcut idempotency: %+v %v", replay, err)
	}
	if _, err := postgres.MutateShoppingShortcut(s.ctx, s.db, postgres.ShoppingShortcutInput{VerticalID: s.verticalID, TitleAr: "نوع آخر", Active: true, StoreTypeIDs: []string{"other-vertical-type"}}, "idempotency-shopping-shortcut-invalid", "invalid", closureAudit("correlation-shortcut-invalid", reason)); !errors.Is(err, postgres.ErrShoppingShortcutInvalid) {
		s.t.Fatalf("foreign/unavailable Store Type allowed: %v", err)
	}
	typeResult, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, ShortcutID: result.Shortcut.ID, Limit: 10})
	if err != nil || len(typeResult.Stores) != 1 || typeResult.Stores[0].ID != "store_catalog_v1" {
		s.t.Fatalf("Store Type shortcut mismatch: %+v %v", typeResult, err)
	}
	categoryOnly := postgres.ShoppingShortcutInput{VerticalID: s.verticalID, TitleAr: "منتجات القهوة", Ordinal: 2, Active: true, CategoryIDs: []string{s.categoryID}}
	categoryResult, err := postgres.MutateShoppingShortcut(s.ctx, s.db, categoryOnly, "idempotency-shopping-shortcut-category", postgres.HashShoppingShortcutMutation(categoryOnly, reason), closureAudit("correlation-shopping-shortcut-category", reason))
	if err != nil {
		s.t.Fatalf("create category shortcut: %v", err)
	}
	publicShortcuts, err := postgres.ListPublicShoppingShortcuts(s.ctx, s.db, s.cityID, s.verticalID)
	if err != nil || len(publicShortcuts) != 2 {
		s.t.Fatalf("public shopping shortcuts: %+v %v", publicShortcuts, err)
	}
	if publicShortcuts[0].ID != result.Shortcut.ID || publicShortcuts[1].ID != categoryResult.Shortcut.ID {
		s.t.Fatalf("public shortcut order incorrect: %+v", publicShortcuts)
	}
	searchQuery := strings.Fields(s.productInput.CanonicalName)[0]
	productMatches, err := postgres.SearchPublicCatalog(s.ctx, s.db, s.cityID, s.verticalID, "", searchQuery, 10, "", result.Shortcut.ID)
	if err != nil || len(productMatches.Offers) == 0 {
		s.t.Fatalf("Store-type shortcut did not return eligible products: %+v %v", productMatches, err)
	}
	for _, offer := range productMatches.Offers {
		if offer.StoreID != "store_catalog_v1" {
			s.t.Fatalf("Store-type shortcut leaked other Store product: %+v", offer)
		}
	}
	noProductMatches, err := postgres.SearchPublicCatalog(s.ctx, s.db, s.cityID, s.verticalID, "", searchQuery, 10, "", "unknown-shortcut")
	if err != nil || len(noProductMatches.Offers) != 0 {
		s.t.Fatalf("unknown shortcut leaked product offers: %+v %v", noProductMatches, err)
	}
	page, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, ShortcutID: categoryResult.Shortcut.ID, Limit: 1})
	if err != nil || len(page.Stores) != 1 || page.NextCursor == "" {
		s.t.Fatalf("category shortcut paginated first page: %+v %v", page, err)
	}
	second, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, ShortcutID: categoryResult.Shortcut.ID, Limit: 1, Cursor: page.NextCursor})
	if err != nil || len(second.Stores) != 1 || second.Stores[0].ID == page.Stores[0].ID {
		s.t.Fatalf("category shortcut pagination: %+v %v", second, err)
	}
	if _, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, ShortcutID: result.Shortcut.ID, Limit: 1, Cursor: page.NextCursor}); !errors.Is(err, postgres.ErrPublicStoreListInvalidInput) {
		s.t.Fatalf("reused scoped cursor accepted: %v", err)
	}
	unknown, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, ShortcutID: "unknown-shortcut", Limit: 10})
	if err != nil || len(unknown.Stores) != 0 {
		s.t.Fatalf("unknown shortcut gave nonempty stores: %+v %v", unknown, err)
	}
	update := categoryOnly
	update.ID = categoryResult.Shortcut.ID
	update.ExpectedVersion = 1
	update.Active = false
	updated, err := postgres.MutateShoppingShortcut(s.ctx, s.db, update, "idempotency-shopping-shortcut-disable", postgres.HashShoppingShortcutMutation(update, reason), closureAudit("correlation-shopping-shortcut-disable", reason))
	if err != nil || updated.Shortcut.Version != 2 || updated.Shortcut.Active {
		s.t.Fatalf("disable shortcut failed: %+v %v", updated, err)
	}
	publicShortcuts, err = postgres.ListPublicShoppingShortcuts(s.ctx, s.db, s.cityID, s.verticalID)
	if err != nil || len(publicShortcuts) != 1 || publicShortcuts[0].ID != result.Shortcut.ID {
		s.t.Fatalf("disabled shortcut leaked to client: %+v %v", publicShortcuts, err)
	}
	hidden, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, ShortcutID: categoryResult.Shortcut.ID, Limit: 10})
	if err != nil || len(hidden.Stores) != 0 {
		s.t.Fatalf("disabled shortcut gave stores: %+v %v", hidden, err)
	}
	stale := update
	stale.TitleAr = "عنوان جديد"
	if _, err := postgres.MutateShoppingShortcut(s.ctx, s.db, stale, "idempotency-shopping-shortcut-stale", postgres.HashShoppingShortcutMutation(stale, reason), closureAudit("correlation-shopping-shortcut-stale", reason)); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
		s.t.Fatalf("stale shortcut update accepted: %v", err)
	}
}
