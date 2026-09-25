package catalog

import (
	"encoding/json"
	"testing"
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
