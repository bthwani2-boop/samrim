package postgres_test

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *catalogRefoundationScenario) verifyOwnedSectionReadback() {
	s.t.Helper()
	section, err := postgres.CreateCatalogStorefrontSection(s.ctx, s.db, postgres.CatalogStorefrontSectionInput{
		StoreID: "store_catalog_v1", NameAr: "قسم تجريبي", Active: true,
	})
	if err != nil || len(section.OfferIDs) != 0 {
		s.t.Fatalf("create owner section: %+v %v", section, err)
	}
	if err := postgres.AttachOfferToCatalogStorefrontSection(s.ctx, s.db, section.ID, s.offerID, 0); err != nil {
		s.t.Fatalf("attach offer to owner section: %v", err)
	}
	items, err := postgres.ListOwnedCatalogStorefrontSections(s.ctx, s.db, "store_catalog_v1")
	if err != nil || len(items) != 1 || items[0].ID != section.ID || len(items[0].OfferIDs) != 1 || items[0].OfferIDs[0] != s.offerID {
		s.t.Fatalf("owner sections must include offer membership: %+v %v", items, err)
	}
	foreign, err := postgres.ListOwnedCatalogStorefrontSections(s.ctx, s.db, "unknown-store")
	if err != nil || len(foreign) != 0 {
		s.t.Fatalf("section list must be scoped to its Store: %+v %v", foreign, err)
	}
}
