package catalog

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
)

func TestCatalogImportAttributeInputsPreserveValues(t *testing.T) {
	integerValue := 12
	enumValue := "Dark"
	values := catalogImportAttributeInputs([]contract.CatalogAttributeValueInput{
		{AttributeID: "roast", ValueKind: "ENUM", EnumValue: &enumValue},
		{AttributeID: "weight", ValueKind: "INTEGER", IntegerValue: &integerValue},
	})

	if len(values) != 2 {
		t.Fatalf("converted %d attribute values, want 2", len(values))
	}
	if values[0].AttributeID != "roast" || values[0].ValueKind != "ENUM" || values[0].EnumValue == nil || *values[0].EnumValue != enumValue {
		t.Fatalf("enum attribute was not preserved: %#v", values[0])
	}
	if values[1].AttributeID != "weight" || values[1].ValueKind != "INTEGER" || values[1].IntegerValue == nil || *values[1].IntegerValue != int64(integerValue) {
		t.Fatalf("integer attribute was not converted: %#v", values[1])
	}
}
