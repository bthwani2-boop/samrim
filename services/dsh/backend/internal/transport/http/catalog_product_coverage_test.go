package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

const catalogTestServiceToken = "Bearer " + "ssssssssssssssssssssssss"

func catalogProductTestRequest(method, path, body, authority string, versioned bool) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if authority == "service" || authority == "service-no-actor" {
		request.Header.Set("Authorization", catalogTestServiceToken)
	}
	if authority == "service" {
		request.Header.Set("X-Acting-Actor-ID", "operator")
	} else if authority == "partner" {
		request.Header.Set("Authorization", "Bearer partner-session")
	}
	request.Header.Set("X-Correlation-ID", "correlation-1")
	request.Header.Set("Idempotency-Key", "idempotency-1")
	if versioned {
		request.Header.Set("X-Expected-Version", "1")
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	return request
}

func TestCatalogProductRoutesStopAtCanonicalAuthAndInputBoundaries(t *testing.T) {
	mux := newCatalogProductValidationMux(t)
	cases := []struct {
		name      string
		method    string
		path      string
		body      string
		authority string
		versioned bool
		status    int
		code      string
	}{
		{name: "product list has no partner session", method: http.MethodGet, path: "/dsh/catalog/products", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "registry has no service token", method: http.MethodGet, path: "/dsh/catalog/product-registry", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "product read has no service token", method: http.MethodGet, path: "/dsh/catalog/products/product-1", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "product create has no service token", method: http.MethodPost, path: "/dsh/catalog/products", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "product update has no service token", method: http.MethodPatch, path: "/dsh/catalog/products/product-1", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "media replacement has no service token", method: http.MethodPut, path: "/dsh/catalog/products/product-1/media", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "product upload has no service token", method: http.MethodPost, path: "/dsh/catalog/products/product-1/media/upload", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "store product upload has no partner session", method: http.MethodPost, path: "/dsh/stores/store-1/products/product-1/media/upload", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "store media replacement has no partner session", method: http.MethodPut, path: "/dsh/stores/store-1/products/product-1/media", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "store product update has no partner session", method: http.MethodPatch, path: "/dsh/stores/store-1/products/product-1", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "offer list has no partner session", method: http.MethodGet, path: "/dsh/stores/store-1/offers", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "offer create has no partner session", method: http.MethodPost, path: "/dsh/stores/store-1/offers", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "offer update has no partner session", method: http.MethodPatch, path: "/dsh/stores/store-1/offers/offer-1", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "media read has no configured store", method: http.MethodGet, path: "/dsh/catalog/media/assets/product/image.png", status: http.StatusServiceUnavailable, code: "MEDIA_STORAGE_UNAVAILABLE"},
		{name: "registry rejects overlong search before actor lookup", method: http.MethodGet, path: "/dsh/catalog/product-registry?q=" + strings.Repeat("q", 161), authority: "service", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "list rejects missing operator actor", method: http.MethodGet, path: "/dsh/catalog/products", authority: "service-no-actor", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "product create rejects malformed JSON", method: http.MethodPost, path: "/dsh/catalog/products", body: "{", authority: "service", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "product update rejects malformed JSON", method: http.MethodPatch, path: "/dsh/catalog/products/product-1", body: "{", authority: "service", versioned: true, status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "media replacement rejects malformed JSON", method: http.MethodPut, path: "/dsh/catalog/products/product-1/media", body: "{", authority: "service", versioned: true, status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "product upload requires configured media storage", method: http.MethodPost, path: "/dsh/catalog/products/product-1/media/upload", authority: "service", versioned: true, status: http.StatusServiceUnavailable, code: "MEDIA_STORAGE_UNAVAILABLE"},
		{name: "store product upload requires configured media storage", method: http.MethodPost, path: "/dsh/stores/store-1/products/product-1/media/upload", authority: "partner", versioned: true, status: http.StatusServiceUnavailable, code: "MEDIA_STORAGE_UNAVAILABLE"},
		{name: "store media replacement rejects malformed JSON", method: http.MethodPut, path: "/dsh/stores/store-1/products/product-1/media", body: "{", authority: "partner", versioned: true, status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "store product update rejects malformed JSON", method: http.MethodPatch, path: "/dsh/stores/store-1/products/product-1", body: "{", authority: "partner", versioned: true, status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "offer list rejects invalid limit", method: http.MethodGet, path: "/dsh/stores/store-1/offers?limit=101", authority: "partner", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "offer create rejects missing idempotency headers", method: http.MethodPost, path: "/dsh/stores/store-1/offers", authority: "partner", status: http.StatusBadRequest, code: "INVALID_INPUT"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := catalogProductTestRequest(tc.method, tc.path, tc.body, tc.authority, tc.versioned)
			if tc.name == "offer create rejects missing idempotency headers" {
				request.Header.Del("X-Correlation-ID")
				request.Header.Del("Idempotency-Key")
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.code) {
				t.Fatalf("response got %d %s, want %d %s", response.Code, response.Body.String(), tc.status, tc.code)
			}
		})
	}
}

func TestCatalogProductViewsPreserveCanonicalCatalogFacts(t *testing.T) {
	brand := "Brand"
	textValue := "text"
	integerValue := int64(12)
	decimalValue := "1.25"
	booleanValue := true
	enumValue := "enum"
	dateValue := "2026-10-02"
	unit := "kg"

	attribute := postgres.CatalogAttributeValueRecord{
		AttributeID: "attribute-1", Code: "weight", ValueKind: "MEASUREMENT",
		TextValue: &textValue, IntegerValue: &integerValue, DecimalValue: &decimalValue,
		BooleanValue: &booleanValue, EnumValue: &enumValue, DateValue: &dateValue, MeasurementUnit: &unit,
	}
	product := toCatalogProduct(postgres.CatalogProductRecord{
		ID: "product-1", VerticalID: "vertical-1", Scope: "SHARED", CanonicalName: "Product", Brand: &brand,
		Active: true, Version: 3, CategoryIDs: []string{"category-1"},
		Attributes: []postgres.CatalogAttributeValueRecord{attribute, {AttributeID: "empty", Code: "empty", ValueKind: "TEXT"}},
		Media:      []postgres.CatalogMediaRecord{{AssetID: "asset-1", URI: "https://media.invalid/asset-1", Role: "PRIMARY", Ordinal: 1}},
		Variants: []postgres.CatalogVariantRecord{{
			ID: "variant-1", ProductID: "product-1", Title: "One kg", MeasurementKind: "WEIGHT", BaseUnit: "GRAM", Active: true, Version: 2,
			Identifiers: []postgres.CatalogIdentifierRecord{{Type: "SKU", Value: "sku-1"}},
			Attributes:  []postgres.CatalogAttributeValueRecord{attribute},
		}},
	})
	if product.ID != "product-1" || product.Brand != brand || product.Version != 3 || !product.Active {
		t.Fatalf("product facts were not preserved: %#v", product)
	}
	if !reflect.DeepEqual(product.CategoryIds, []string{"category-1"}) || len(product.Media) != 1 || product.Media[0].AssetID != "asset-1" {
		t.Fatalf("product category or media facts were not preserved: %#v", product)
	}
	if len(product.Variants) != 1 || product.Variants[0].Identifiers[0].Value != "sku-1" || product.Variants[0].Attributes[0].IntegerValue == nil || *product.Variants[0].Attributes[0].IntegerValue != 12 {
		t.Fatalf("variant facts were not preserved: %#v", product.Variants)
	}
	gotAttribute := product.Attributes[0]
	if gotAttribute.TextValue == nil || *gotAttribute.TextValue != textValue || gotAttribute.IntegerValue == nil || *gotAttribute.IntegerValue != int(integerValue) ||
		gotAttribute.DecimalValue == nil || *gotAttribute.DecimalValue != decimalValue || gotAttribute.BooleanValue == nil || !*gotAttribute.BooleanValue ||
		gotAttribute.EnumValue == nil || *gotAttribute.EnumValue != enumValue || gotAttribute.DateValue == nil || *gotAttribute.DateValue != dateValue ||
		gotAttribute.MeasurementUnit == nil || *gotAttribute.MeasurementUnit != unit {
		t.Fatalf("typed attribute values were not preserved: %#v", gotAttribute)
	}
	if gotEmpty := product.Attributes[1]; gotEmpty.TextValue != nil || gotEmpty.IntegerValue != nil || gotEmpty.DecimalValue != nil || gotEmpty.BooleanValue != nil || gotEmpty.EnumValue != nil || gotEmpty.DateValue != nil || gotEmpty.MeasurementUnit != nil {
		t.Fatalf("absent typed attribute values were populated: %#v", gotEmpty)
	}

	vertical := toCommerceVertical(postgres.CommerceVerticalRecord{ID: "vertical-1", Active: true, Version: 4})
	storeType := toCommercialStoreType(postgres.CommercialStoreTypeRecord{ID: "type-1", VerticalID: "vertical-1", Active: true, Version: 5})
	category := toCatalogCategory(postgres.CatalogCategoryRecord{ID: "category-1", VerticalID: "vertical-1", ParentCategoryID: "parent-1", ImageURI: "https://media.invalid/category", Active: true, Version: 6})
	categoryRow := toCatalogCategoryListItem(postgres.CatalogCategoryListItem{CatalogCategoryRecord: postgres.CatalogCategoryRecord{ID: "category-2", ImageURI: "image"}, PathAr: "مسار", PathEn: "Path"})
	if vertical.ID != "vertical-1" || !vertical.Active || vertical.Version != 4 || storeType.ID != "type-1" || storeType.Version != 5 || category.ParentCategoryID != "parent-1" || category.Version != 6 || categoryRow.PathAr != "مسار" || categoryRow.PathEn != "Path" {
		t.Fatalf("catalog view conversion lost canonical facts: vertical=%#v storeType=%#v category=%#v row=%#v", vertical, storeType, category, categoryRow)
	}
}

func TestCommercialStoreTypeHandlersValidateAuthorityAndInputsBeforeStorage(t *testing.T) {
	mux := newCatalogProductValidationMux(t)
	cases := []struct {
		name      string
		method    string
		path      string
		body      string
		authority string
		actor     bool
		mutation  bool
		status    int
		code      string
	}{
		{name: "public list requires a vertical", method: http.MethodGet, path: "/dsh/catalog/commercial-store-types", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "inactive list requires service authentication", method: http.MethodGet, path: "/dsh/catalog/commercial-store-types?verticalId=vertical-1&includeInactive=true", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "inactive list requires operator identity", method: http.MethodGet, path: "/dsh/catalog/commercial-store-types?verticalId=vertical-1&includeInactive=true", authority: "service-no-actor", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "create requires service authentication", method: http.MethodPost, path: "/dsh/catalog/commercial-store-types", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "create requires mutation headers", method: http.MethodPost, path: "/dsh/catalog/commercial-store-types", authority: "service", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "create rejects malformed body", method: http.MethodPost, path: "/dsh/catalog/commercial-store-types", body: "{", authority: "service", actor: true, mutation: true, status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "update requires service authentication", method: http.MethodPatch, path: "/dsh/catalog/commercial-store-types/type-1", status: http.StatusUnauthorized, code: "UNAUTHENTICATED"},
		{name: "update requires mutation headers", method: http.MethodPatch, path: "/dsh/catalog/commercial-store-types/type-1", authority: "service", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "update rejects malformed body", method: http.MethodPatch, path: "/dsh/catalog/commercial-store-types/type-1", body: "{", authority: "service", actor: true, mutation: true, status: http.StatusBadRequest, code: "INVALID_INPUT"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := catalogProductTestRequest(tc.method, tc.path, tc.body, tc.authority, false)
			if tc.actor && tc.authority == "service" {
				request.Header.Set("X-Acting-Actor-ID", "operator")
			}
			if !tc.mutation {
				request.Header.Del("X-Correlation-ID")
				request.Header.Del("Idempotency-Key")
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.code) {
				t.Fatalf("response got %d %s, want %d %s", response.Code, response.Body.String(), tc.status, tc.code)
			}
		})
	}
}

func TestCommercialStoreTypeErrorsKeepTheCatalogErrorContract(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{name: "missing type", err: postgres.ErrCommercialStoreTypeNotFound, status: http.StatusNotFound, code: "NOT_FOUND"},
		{name: "invalid type facts", err: postgres.ErrCommercialStoreTypeInvalid, status: http.StatusBadRequest, code: "INVALID_INPUT"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeCatalogError(response, tc.err)
			if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.code) {
				t.Fatalf("error response got %d %s, want %d %s", response.Code, response.Body.String(), tc.status, tc.code)
			}
		})
	}
}
