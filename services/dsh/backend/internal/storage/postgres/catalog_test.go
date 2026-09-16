package postgres

import (
	"strings"
	"testing"
)

func TestValidateOfferInputRequiresExplicitMeasurementPricing(t *testing.T) {
	tests := []struct {
		name      string
		input     CatalogOfferInput
		wantError bool
	}{
		{
			name: "discrete per unit",
			input: CatalogOfferInput{
				StoreID: "store", VariantID: "variant", PriceMinor: 1,
				QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1,
				PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1,
			},
		},
		{
			name: "measured per measure",
			input: CatalogOfferInput{
				StoreID: "store", VariantID: "variant", PriceMinor: 1,
				QuantityPolicy: "MEASURED", QuantityMinBaseUnits: 500, QuantityMaxBaseUnits: 5000, QuantityStepBaseUnits: 500,
				PricingBasis: "PER_MEASURE", PricingUnitBaseUnits: 500,
			},
		},
		{
			name: "variable draft facts may be stored but are not customer visible",
			input: CatalogOfferInput{
				StoreID: "store", VariantID: "variant", PriceMinor: 1,
				QuantityPolicy: "VARIABLE_MEASURE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1,
				PricingBasis: "PER_MEASURE", PricingUnitBaseUnits: 1,
			},
		},
		{
			name: "discrete cannot use per measure",
			input: CatalogOfferInput{
				StoreID: "store", VariantID: "variant", PriceMinor: 1,
				QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1,
				PricingBasis: "PER_MEASURE", PricingUnitBaseUnits: 1,
			},
			wantError: true,
		},
		{
			name: "measured cannot use per unit",
			input: CatalogOfferInput{
				StoreID: "store", VariantID: "variant", PriceMinor: 1,
				QuantityPolicy: "MEASURED", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1,
				PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1,
			},
			wantError: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := validateOfferInput(test.input); (got != nil) != test.wantError {
				t.Fatalf("validateOfferInput() error = %v, wantError = %v", got, test.wantError)
			}
		})
	}
}

func TestPublishableCatalogOfferConditionsExcludeVariableMeasurement(t *testing.T) {
	conditions := publishableCatalogOfferConditionsForAliases("offer", "variant", "product", "store")
	needle := "offer.quantity_policy<>'VARIABLE_MEASURE'"
	for _, condition := range conditions {
		if strings.TrimSpace(condition) == needle {
			return
		}
	}
	t.Fatalf("publishable conditions do not contain %q", needle)
}
