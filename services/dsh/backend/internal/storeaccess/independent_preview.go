package storeaccess

import (
	"context"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// IndependentStorePreview is an authenticated, never-shareable composition of
// the canonical Store and Catalog. No public visibility or order capability
// is implied by StoreOffer publication or by a successful preview read.
type IndependentStorePreview struct {
	StoreID          string                    `json:"storeId"`
	Name             string                    `json:"name"`
	RelationModel    string                    `json:"relationModel"`
	PublicationState string                    `json:"publicationState"`
	ProfileImageURI  string                    `json:"profileImageUri"`
	CoverImageURI    string                    `json:"coverImageUri"`
	PreviewOnly      bool                      `json:"previewOnly"`
	CheckoutEnabled  bool                      `json:"checkoutEnabled"`
	Offers           []IndependentPreviewOffer `json:"offers"`
	NextCursor       string                    `json:"nextCursor"`
}

type IndependentPreviewOffer struct {
	ID               string `json:"id"`
	ProductID        string `json:"productId"`
	Title            string `json:"title"`
	PriceMinor       int64  `json:"priceMinor"`
	Currency         string `json:"currency"`
	ImageURI         string `json:"imageUri"`
	Availability     bool   `json:"availability"`
	PublicationState string `json:"publicationState"`
}

// ReadIndependentPreview proves the Partner session and Store ownership
// before reading even unpublished product data. Delegated roles and Client
// sessions do not gain a new private Store data read through this endpoint.
func (s *Service) ReadIndependentPreview(ctx context.Context, token, storeID string, limit int, cursor string) (IndependentStorePreview, error) {
	actorID, err := s.partnerActor(ctx, token)
	if err != nil {
		return IndependentStorePreview{}, err
	}
	// Keep the owner/relation check, independent publication, media and
	// Catalog on one transaction snapshot. A Store transfer must never pair
	// authorization from the former owner with a newer Catalog read.
	store, independentPublicationState, page, err := postgres.ReadIndependentPreviewSnapshotForOwner(
		ctx, s.db, storeID, actorID, limit, cursor)
	if err != nil {
		return IndependentStorePreview{}, err
	}
	preview := IndependentStorePreview{
		StoreID: store.ID, Name: store.Name, RelationModel: store.RelationModel,
		PublicationState: independentPublicationState, PreviewOnly: true,
		CheckoutEnabled: false, Offers: make([]IndependentPreviewOffer, 0, len(page.Offers)),
		NextCursor: page.NextCursor,
	}
	if store.StoreProfileImage != nil {
		preview.ProfileImageURI = store.StoreProfileImage.URI
	}
	if store.StoreCoverImage != nil {
		preview.CoverImageURI = store.StoreCoverImage.URI
	}
	for _, offer := range page.Offers {
		item := IndependentPreviewOffer{
			ID: offer.ID, ProductID: offer.Product.ID, Title: offer.Product.CanonicalName,
			PriceMinor: offer.PriceMinor, Currency: offer.Currency,
			Availability: offer.Availability, PublicationState: offer.PublicationState,
		}
		if len(offer.Product.Media) > 0 {
			item.ImageURI = offer.Product.Media[0].URI
		}
		preview.Offers = append(preview.Offers, item)
	}
	return preview, nil
}
