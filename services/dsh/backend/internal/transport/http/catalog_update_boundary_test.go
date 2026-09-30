package transporthttp

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
)

func TestCatalogUpdateConvertersPreserveOmission(t *testing.T) {
	t.Helper()

	if got := catalogAttributeInputsFromContract(nil); got != nil {
		t.Fatalf("omitted attributeValues must remain nil, got %#v", got)
	}
	if got := catalogVariantAttributeValueSets(nil); got != nil {
		t.Fatalf("omitted variantAttributeValues must remain nil, got %#v", got)
	}
}

func TestCatalogUpdateConvertersPreserveExplicitEmpty(t *testing.T) {
	t.Helper()

	if catalogAttributeInputsFromContract([]contract.CatalogAttributeValueInput{}) == nil {
		t.Fatal("explicit empty attributeValues must remain non-nil")
	}
	if catalogVariantAttributeValueSets([]contract.CatalogVariantAttributeValueSet{}) == nil {
		t.Fatal("explicit empty variantAttributeValues must remain non-nil")
	}
}
