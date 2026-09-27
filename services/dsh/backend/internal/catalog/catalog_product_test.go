package catalog

import (
	"encoding/json"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestNormalizeCatalogAttributeValuesKeepsEmptyArray(t *testing.T) {
	normalized := normalizeCatalogAttributeValues(nil)
	if normalized == nil {
		t.Fatal("empty catalog attribute values must remain an empty array")
	}

	encoded, err := json.Marshal(normalized)
	if err != nil {
		t.Fatalf("marshal normalized empty catalog attribute values: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("normalized empty catalog attribute values = %s, want []", encoded)
	}
}

func TestNormalizeCatalogProductUpdateKeepsOptionalCategoryAndVariantValues(t *testing.T) {
	input := postgres.CatalogProductUpdateInput{
		VerticalID:             "vertical_grocery",
		Scope:                  "SHARED",
		CanonicalName:          "قهوة عربية",
		CategoryIDs:            []string{" category_drinks ", "category_grocery", "category_drinks"},
		AttributeValues:        []postgres.CatalogAttributeValueInput{},
		VariantAttributeValues: []postgres.CatalogVariantAttributeValueSet{{VariantID: "variant_b", Values: []postgres.CatalogAttributeValueInput{}}, {VariantID: " variant_a ", Values: []postgres.CatalogAttributeValueInput{}}},
	}

	got, err := normalizeCatalogProductUpdateInput(input)
	if err != nil {
		t.Fatalf("normalize product category update: %v", err)
	}
	if got.CategoryIDs == nil || len(got.CategoryIDs) != 2 || got.CategoryIDs[0] != "category_drinks" || got.CategoryIDs[1] != "category_grocery" {
		t.Fatalf("normalized category IDs = %#v, want sorted unique IDs", got.CategoryIDs)
	}
	if got.AttributeValues == nil || len(got.AttributeValues) != 0 {
		t.Fatalf("empty product attribute values must remain an empty array, got %#v", got.AttributeValues)
	}
	if got.VariantAttributeValues == nil || len(got.VariantAttributeValues) != 2 || got.VariantAttributeValues[0].VariantID != "variant_a" || got.VariantAttributeValues[0].Values == nil {
		t.Fatalf("normalized per-variant attribute sets = %#v, want sorted variant IDs with empty arrays preserved", got.VariantAttributeValues)
	}

	unchanged, err := normalizeCatalogProductUpdateInput(postgres.CatalogProductUpdateInput{VerticalID: "vertical_grocery", Scope: "SHARED", CanonicalName: "قهوة عربية"})
	if err != nil {
		t.Fatalf("normalize scalar-only update: %v", err)
	}
	if unchanged.CategoryIDs != nil || unchanged.AttributeValues != nil || unchanged.VariantAttributeValues != nil {
		t.Fatalf("omitted category assignment fields must remain omitted: %#v", unchanged)
	}
}

func TestNormalizeCatalogProductUpdateRequiresCategoryValuesTogether(t *testing.T) {
	_, err := normalizeCatalogProductUpdateInput(postgres.CatalogProductUpdateInput{VerticalID: "vertical_grocery", Scope: "SHARED", CanonicalName: "قهوة عربية", AttributeValues: []postgres.CatalogAttributeValueInput{}})
	if err != postgres.ErrCatalogCategoryNotFound {
		t.Fatalf("partial category assignment update error = %v, want ErrCatalogCategoryNotFound", err)
	}
}

func TestNormalizeCatalogMediaAcceptsOnlyUniqueAssetReferences(t *testing.T) {
	items, err := normalizeCatalogMedia([]postgres.CatalogMediaInput{
		{AssetID: "media_asset_primary", Role: " primary ", Ordinal: 0},
		{AssetID: "media_asset_gallery", Role: "GALLERY", Ordinal: 1},
	})
	if err != nil || len(items) != 2 || items[0].AssetID != "media_asset_primary" || items[1].AssetID != "media_asset_gallery" {
		t.Fatalf("normalized catalog media = %#v, err=%v", items, err)
	}
	for _, invalid := range [][]postgres.CatalogMediaInput{
		{{AssetID: "https://example.test/image.jpg", Role: "primary", Ordinal: 0}},
		{{AssetID: "media_asset_same", Role: "primary", Ordinal: 0}, {AssetID: "media_asset_same", Role: "gallery", Ordinal: 1}},
		{{AssetID: " media_asset_primary", Role: "primary", Ordinal: 0}},
	} {
		if _, err := normalizeCatalogMedia(invalid); err != ErrCatalogProductImageInvalid {
			t.Fatalf("invalid catalog media %#v returned %v, want ErrCatalogProductImageInvalid", invalid, err)
		}
	}
}
