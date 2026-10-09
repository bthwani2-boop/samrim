package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestCatalogAttributeRegistryLifecycle(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the isolated catalog attribute proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open DSH test PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("connect DSH test PostgreSQL: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply canonical DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical DSH schema: %v", err)
		}
		api := newDSHCatalogTestAPI(t, db, nil)

		suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
		vertical := postgres.CommerceVerticalRecord{ID: "attribute-vertical-" + suffix, NameAr: "مجال السمات", NameEn: "Attribute Vertical", Active: true}
		verticalReason := "Create attribute test vertical"
		verticalAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-attribute-vertical-" + suffix, Reason: verticalReason}
		if _, err := postgres.CreateCommerceVertical(ctx, db, vertical, "idem-attribute-vertical-"+suffix, postgres.HashCatalogVerticalCreateRequest(vertical, verticalReason), verticalAudit); err != nil {
			t.Fatalf("create attribute owner vertical: %v", err)
		}

		definitionInput := contract.CreateCatalogAttributeDefinitionRequest{ID: "attribute-color-" + suffix, VerticalID: vertical.ID, Code: "color", NameAr: "اللون", ValueKind: "ENUM", Active: true}
		definitionReason := "Create color attribute definition"
		definitionInput.Reason = definitionReason
		definitionResponse := api.request(t, http.MethodPost, "/dsh/catalog/attributes", definitionInput, "corr-attribute-definition-"+suffix, "idem-attribute-definition-"+suffix, 0)
		if definitionResponse.Code != http.StatusCreated {
			t.Fatalf("create catalog attribute definition API response=%d body=%s", definitionResponse.Code, definitionResponse.Body.String())
		}
		var createdDefinition contract.CatalogAttributeDefinitionResponse
		if err := json.Unmarshal(definitionResponse.Body.Bytes(), &createdDefinition); err != nil {
			t.Fatalf("decode created attribute API response: %v", err)
		}
		definition := postgres.CatalogAttributeDefinitionRecord{ID: createdDefinition.Definition.ID, VerticalID: createdDefinition.Definition.VerticalID, Code: createdDefinition.Definition.Code, NameAr: createdDefinition.Definition.NameAr, ValueKind: createdDefinition.Definition.ValueKind, Active: createdDefinition.Definition.Active, Version: createdDefinition.Definition.Version}
		optionInput := contract.CreateCatalogAttributeEnumOptionRequest{OptionValue: "أحمر", Active: true, Ordinal: 0}
		optionReason := "Create red color option"
		optionInput.Reason = optionReason
		optionResponse := api.request(t, http.MethodPost, "/dsh/catalog/attributes/"+definition.ID+"/enum-options", optionInput, "corr-attribute-option-"+suffix, "idem-attribute-option-"+suffix, 0)
		if optionResponse.Code != http.StatusCreated {
			t.Fatalf("create catalog enum option API response=%d body=%s", optionResponse.Code, optionResponse.Body.String())
		}
		var createdOption contract.CatalogAttributeEnumOptionResponse
		if err := json.Unmarshal(optionResponse.Body.Bytes(), &createdOption); err != nil {
			t.Fatalf("decode created enum option API response: %v", err)
		}
		option := postgres.CatalogAttributeEnumOptionRecord{AttributeID: createdOption.Option.AttributeID, OptionValue: createdOption.Option.OptionValue, Active: createdOption.Option.Active, Ordinal: createdOption.Option.Ordinal, Version: createdOption.Option.Version}
		var optionMutationOperation string
		if err := db.QueryRowContext(ctx, "SELECT operation FROM dsh.catalog_attribute_mutation_idempotency WHERE idempotency_key=$1", "idem-attribute-option-"+suffix).Scan(&optionMutationOperation); err != nil || optionMutationOperation != "create" {
			t.Fatalf("enum option creation idempotency operation=%q error=%v, want create", optionMutationOperation, err)
		}
		optionReplay := api.request(t, http.MethodPost, "/dsh/catalog/attributes/"+definition.ID+"/enum-options", optionInput, "corr-attribute-option-"+suffix, "idem-attribute-option-"+suffix, 0)
		var replayedOption contract.CatalogAttributeEnumOptionResponse
		if optionReplay.Code != http.StatusOK || json.Unmarshal(optionReplay.Body.Bytes(), &replayedOption) != nil || !replayedOption.IdempotentReplay || replayedOption.Option.Version != 1 {
			t.Fatalf("replay catalog enum option API response=%d body=%s", optionReplay.Code, optionReplay.Body.String())
		}

		var auditCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_registry_audit_events WHERE entity_type IN ('attribute_definition','attribute_enum_option')").Scan(&auditCount); err != nil {
			t.Fatalf("read attribute audit history: %v", err)
		}
		if auditCount != 2 {
			t.Fatalf("attribute definition and option creation audit count=%d, want 2", auditCount)
		}

		var optionVersion int
		if err := db.QueryRowContext(ctx, "SELECT version FROM dsh.catalog_attribute_enum_options WHERE attribute_id=$1 AND option_value='أحمر'", definition.ID).Scan(&optionVersion); err != nil {
			t.Fatalf("read canonical enum option version: %v", err)
		}
		if optionVersion != 1 {
			t.Fatalf("new enum option version=%d, want 1", optionVersion)
		}

		category := postgres.CatalogCategoryRecord{ID: "attribute-category-" + suffix, VerticalID: vertical.ID, NameAr: "مشروبات السمات", NameEn: "Attribute Drinks", Active: true}
		categoryReason := "Create category for attribute rules"
		categoryAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-attribute-category-" + suffix, Reason: categoryReason}
		if _, err := postgres.CreateCatalogCategory(ctx, db, category, "idem-attribute-category-"+suffix, postgres.HashCatalogCategoryCreateRequest(category, categoryReason), categoryAudit); err != nil {
			t.Fatalf("create category for attribute rule: %v", err)
		}
		rule := postgres.CatalogAttributeRuleRecord{CategoryID: category.ID, AttributeID: definition.ID, Required: true, Filterable: true}
		ruleReason := "Allow filtering by color"
		ruleResponse := api.request(t, http.MethodPut, "/dsh/catalog/categories/"+category.ID+"/attribute-rules/"+definition.ID, contract.UpsertCatalogAttributeRuleRequest{Required: rule.Required, Filterable: rule.Filterable, VariantAxis: rule.VariantAxis, ExpectedVersion: 0, Reason: ruleReason}, "corr-attribute-rule-"+suffix, "idem-attribute-rule-"+suffix, 0)
		if ruleResponse.Code != http.StatusOK {
			t.Fatalf("enable category attribute filter API response=%d body=%s", ruleResponse.Code, ruleResponse.Body.String())
		}
		var returnedRules contract.CatalogAttributeRuleListResponse
		if err := json.Unmarshal(ruleResponse.Body.Bytes(), &returnedRules); err != nil || len(returnedRules.Rules) != 1 || !returnedRules.Rules[0].Filterable {
			t.Fatalf("filterable category rule API readback=%+v body=%s error=%v", returnedRules, ruleResponse.Body.String(), err)
		}
		rules, err := postgres.ReadCatalogAttributeRules(ctx, db, category.ID)
		if err != nil || len(rules) != 1 || !rules[0].Required || !rules[0].Filterable || rules[0].Version != 1 {
			t.Fatalf("filterable category attribute rule readback = %+v, error=%v", rules, err)
		}
		publicRuleResponse := api.request(t, http.MethodGet, "/dsh/public/catalog/categories/"+category.ID+"/attribute-rules", nil, "", "", 0)
		var publicRules contract.CatalogAttributeRuleListResponse
		if publicRuleResponse.Code != http.StatusOK || json.Unmarshal(publicRuleResponse.Body.Bytes(), &publicRules) != nil || len(publicRules.Rules) != 1 || !publicRules.Rules[0].Filterable {
			t.Fatalf("public filterable rule API response=%d body=%s", publicRuleResponse.Code, publicRuleResponse.Body.String())
		}
		publicOptionResponse := api.request(t, http.MethodGet, "/dsh/public/catalog/attributes/"+definition.ID+"/enum-options", nil, "", "", 0)
		var publicOptions contract.CatalogAttributeEnumOptionListResponse
		if publicOptionResponse.Code != http.StatusOK || json.Unmarshal(publicOptionResponse.Body.Bytes(), &publicOptions) != nil || len(publicOptions.Options) != 1 || !publicOptions.Options[0].Active {
			t.Fatalf("public active enum options API response=%d body=%s", publicOptionResponse.Code, publicOptionResponse.Body.String())
		}

		enumValue := "أحمر"
		productInput := postgres.CatalogProductInput{ID: "attribute-product-" + suffix, VerticalID: vertical.ID, Scope: "SHARED", CanonicalName: "شاي أحمر", VariantTitle: "الافتراضي", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", CategoryIDs: []string{category.ID}, AttributeValues: []postgres.CatalogAttributeValueInput{{AttributeID: definition.ID, ValueKind: "ENUM", EnumValue: &enumValue}}}
		missingRequired := productInput
		missingRequired.ID += "-missing-required"
		missingRequired.AttributeValues = nil
		if _, err := postgres.CreateCatalogProduct(ctx, db, missingRequired, "idem-attribute-product-missing-"+suffix, postgres.HashCatalogProductCreateRequest(missingRequired), testOperatorActorID, "corr-attribute-product-missing-"+suffix); !errors.Is(err, postgres.ErrCatalogCategoryNotFound) {
			t.Fatalf("create product without required enum attribute error=%v, want required rule rejection", err)
		}
		createdProduct, err := postgres.CreateCatalogProduct(ctx, db, productInput, "idem-attribute-product-"+suffix, postgres.HashCatalogProductCreateRequest(productInput), testOperatorActorID, "corr-attribute-product-"+suffix)
		if err != nil || createdProduct.Product.ID != productInput.ID {
			t.Fatalf("create product with typed enum value=%+v error=%v", createdProduct, err)
		}
		productRead, err := postgres.ReadCatalogProduct(ctx, db, productInput.ID)
		if err != nil || len(productRead.Attributes) != 1 || productRead.Attributes[0].EnumValue == nil || *productRead.Attributes[0].EnumValue != enumValue {
			t.Fatalf("typed product attribute canonical readback=%+v error=%v", productRead.Attributes, err)
		}

		api.permissionEnabled = false
		unauthorizedDefinition := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID, contract.UpdateCatalogAttributeDefinitionRequest{NameAr: definition.NameAr, Active: false, ExpectedVersion: 1, Reason: "Reject unauthorized attribute edit"}, "corr-attribute-definition-denied-"+suffix, "idem-attribute-definition-denied-"+suffix, 0)
		if unauthorizedDefinition.Code != http.StatusForbidden || !strings.Contains(unauthorizedDefinition.Body.String(), "FORBIDDEN") {
			t.Fatalf("attribute update without Catalog permission status=%d body=%s, want FORBIDDEN", unauthorizedDefinition.Code, unauthorizedDefinition.Body.String())
		}
		api.permissionEnabled = true

		deactivateDefinitionReason := "Pause color attribute"
		deactivateDefinition := contract.UpdateCatalogAttributeDefinitionRequest{NameAr: definition.NameAr, Active: false, ExpectedVersion: 1, Reason: deactivateDefinitionReason}
		deactivateDefinitionKey := "idem-attribute-definition-disable-" + suffix
		deactivateDefinitionCorrelation := "corr-attribute-definition-disable-" + suffix
		definitionResponse = api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID, deactivateDefinition, deactivateDefinitionCorrelation, deactivateDefinitionKey, 0)
		var updatedDefinition contract.CatalogAttributeDefinitionResponse
		if definitionResponse.Code != http.StatusOK || json.Unmarshal(definitionResponse.Body.Bytes(), &updatedDefinition) != nil || updatedDefinition.Definition.Active || updatedDefinition.Definition.Version != 2 || updatedDefinition.IdempotentReplay {
			t.Fatalf("deactivate attribute definition API response=%d body=%s", definitionResponse.Code, definitionResponse.Body.String())
		}
		definitionReplayResponse := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID, deactivateDefinition, deactivateDefinitionCorrelation, deactivateDefinitionKey, 0)
		var definitionReplay contract.CatalogAttributeDefinitionResponse
		if definitionReplayResponse.Code != http.StatusOK || json.Unmarshal(definitionReplayResponse.Body.Bytes(), &definitionReplay) != nil || !definitionReplay.IdempotentReplay || definitionReplay.Definition.Version != 2 {
			t.Fatalf("replay attribute definition API response=%d body=%s", definitionReplayResponse.Code, definitionReplayResponse.Body.String())
		}
		staleDefinition := deactivateDefinition
		staleDefinition.NameAr = "اسم قديم"
		staleDefinition.Reason = "Reject stale attribute edit"
		staleDefinitionResponse := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID, staleDefinition, "corr-attribute-definition-stale-"+suffix, "idem-attribute-definition-stale-"+suffix, 0)
		if staleDefinitionResponse.Code != http.StatusConflict || !strings.Contains(staleDefinitionResponse.Body.String(), "VERSION_CONFLICT") {
			t.Fatalf("stale attribute definition API response=%d body=%s, want version conflict", staleDefinitionResponse.Code, staleDefinitionResponse.Body.String())
		}
		activeDefinitionsResponse := api.request(t, http.MethodGet, "/dsh/catalog/attributes?verticalId="+vertical.ID, nil, "", "", 0)
		var activeDefinitions contract.CatalogAttributeDefinitionListResponse
		if activeDefinitionsResponse.Code != http.StatusOK || json.Unmarshal(activeDefinitionsResponse.Body.Bytes(), &activeDefinitions) != nil || len(activeDefinitions.Definitions) != 0 {
			t.Fatalf("active attribute definition API read after deactivation=%d body=%s", activeDefinitionsResponse.Code, activeDefinitionsResponse.Body.String())
		}
		allDefinitionsResponse := api.request(t, http.MethodGet, "/dsh/catalog/attributes?verticalId="+vertical.ID+"&includeInactive=true", nil, "", "", 0)
		var allDefinitions contract.CatalogAttributeDefinitionListResponse
		if allDefinitionsResponse.Code != http.StatusOK || json.Unmarshal(allDefinitionsResponse.Body.Bytes(), &allDefinitions) != nil || len(allDefinitions.Definitions) != 1 || allDefinitions.Definitions[0].Active || allDefinitions.Definitions[0].Version != 2 {
			t.Fatalf("operator attribute definition API read after deactivation=%d body=%s", allDefinitionsResponse.Code, allDefinitionsResponse.Body.String())
		}
		inactivePublicOptionsResponse := api.request(t, http.MethodGet, "/dsh/public/catalog/attributes/"+definition.ID+"/enum-options", nil, "", "", 0)
		var activeOptions contract.CatalogAttributeEnumOptionListResponse
		if inactivePublicOptionsResponse.Code != http.StatusOK || json.Unmarshal(inactivePublicOptionsResponse.Body.Bytes(), &activeOptions) != nil || len(activeOptions.Options) != 0 {
			t.Fatalf("public options for inactive definition API response=%d body=%s", inactivePublicOptionsResponse.Code, inactivePublicOptionsResponse.Body.String())
		}
		productRead, err = postgres.ReadCatalogProduct(ctx, db, productInput.ID)
		if err != nil || len(productRead.Attributes) != 1 || productRead.Attributes[0].EnumValue == nil || *productRead.Attributes[0].EnumValue != enumValue {
			t.Fatalf("deactivating definition erased existing product value=%+v error=%v", productRead.Attributes, err)
		}

		reactivateDefinition := deactivateDefinition
		reactivateDefinition.Active = true
		reactivateDefinition.ExpectedVersion = 2
		reactivateReason := "Reactivate color attribute"
		reactivateDefinition.Reason = reactivateReason
		reactivateDefinitionResponse := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID, reactivateDefinition, "corr-attribute-definition-reactivate-"+suffix, "idem-attribute-definition-reactivate-"+suffix, 0)
		var reactivatedDefinition contract.CatalogAttributeDefinitionResponse
		if reactivateDefinitionResponse.Code != http.StatusOK || json.Unmarshal(reactivateDefinitionResponse.Body.Bytes(), &reactivatedDefinition) != nil || !reactivatedDefinition.Definition.Active || reactivatedDefinition.Definition.Version != 3 {
			t.Fatalf("reactivate attribute definition API response=%d body=%s", reactivateDefinitionResponse.Code, reactivateDefinitionResponse.Body.String())
		}
		concurrentUpdates := []contract.UpdateCatalogAttributeDefinitionRequest{
			{NameAr: "اللون الأول", Active: true, ExpectedVersion: 3, Reason: "Concurrent color label edit one"},
			{NameAr: "اللون الثاني", Active: true, ExpectedVersion: 3, Reason: "Concurrent color label edit two"},
		}
		concurrentStart := make(chan struct{})
		concurrentResponses := make(chan *httptest.ResponseRecorder, len(concurrentUpdates))
		for index, update := range concurrentUpdates {
			go func(index int, update contract.UpdateCatalogAttributeDefinitionRequest) {
				<-concurrentStart
				response := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID, update, fmt.Sprintf("corr-attribute-race-%d-%s", index, suffix), fmt.Sprintf("idem-attribute-race-%d-%s", index, suffix), 0)
				concurrentResponses <- response
			}(index, update)
		}
		close(concurrentStart)
		concurrentSuccess, concurrentVersionConflicts := 0, 0
		for range concurrentUpdates {
			response := <-concurrentResponses
			switch response.Code {
			case http.StatusOK:
				concurrentSuccess++
			case http.StatusConflict:
				if strings.Contains(response.Body.String(), "VERSION_CONFLICT") {
					concurrentVersionConflicts++
				} else {
					t.Fatalf("concurrent attribute update returned unexpected conflict: %s", response.Body.String())
				}
			default:
				t.Fatalf("concurrent attribute update returned %d: %s", response.Code, response.Body.String())
			}
		}
		if concurrentSuccess != 1 || concurrentVersionConflicts != 1 {
			t.Fatalf("concurrent updates at the same version succeeded=%d conflicts=%d, want one each", concurrentSuccess, concurrentVersionConflicts)
		}
		deactivateOption := contract.UpdateCatalogAttributeEnumOptionRequest{Active: false, Ordinal: option.Ordinal, ExpectedVersion: 1}
		optionDisableReason := "Pause red color option"
		deactivateOption.Reason = optionDisableReason
		deactivateOptionResponse := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID+"/enum-options/"+option.OptionValue, deactivateOption, "corr-attribute-option-disable-"+suffix, "idem-attribute-option-disable-"+suffix, 0)
		var updatedOption contract.CatalogAttributeEnumOptionResponse
		if deactivateOptionResponse.Code != http.StatusOK || json.Unmarshal(deactivateOptionResponse.Body.Bytes(), &updatedOption) != nil || updatedOption.Option.Active || updatedOption.Option.Version != 2 {
			t.Fatalf("deactivate enum option API response=%d body=%s", deactivateOptionResponse.Code, deactivateOptionResponse.Body.String())
		}
		activeOptionResponse := api.request(t, http.MethodGet, "/dsh/public/catalog/attributes/"+definition.ID+"/enum-options", nil, "", "", 0)
		if activeOptionResponse.Code != http.StatusOK || json.Unmarshal(activeOptionResponse.Body.Bytes(), &activeOptions) != nil || len(activeOptions.Options) != 0 {
			t.Fatalf("public options after option deactivation API response=%d body=%s", activeOptionResponse.Code, activeOptionResponse.Body.String())
		}
		allOptionsResponse := api.request(t, http.MethodGet, "/dsh/catalog/attributes/"+definition.ID+"/enum-options?includeInactive=true", nil, "", "", 0)
		var allOptions contract.CatalogAttributeEnumOptionListResponse
		if allOptionsResponse.Code != http.StatusOK || json.Unmarshal(allOptionsResponse.Body.Bytes(), &allOptions) != nil || len(allOptions.Options) != 1 || allOptions.Options[0].Active || allOptions.Options[0].Version != 2 {
			t.Fatalf("operator options after option deactivation API response=%d body=%s", allOptionsResponse.Code, allOptionsResponse.Body.String())
		}
		reactivateOption := deactivateOption
		reactivateOption.Active = true
		reactivateOption.ExpectedVersion = 2
		optionReactivateReason := "Reactivate red color option"
		reactivateOption.Reason = optionReactivateReason
		reactivateOptionResponse := api.request(t, http.MethodPatch, "/dsh/catalog/attributes/"+definition.ID+"/enum-options/"+option.OptionValue, reactivateOption, "corr-attribute-option-reactivate-"+suffix, "idem-attribute-option-reactivate-"+suffix, 0)
		var reactivatedOption contract.CatalogAttributeEnumOptionResponse
		if reactivateOptionResponse.Code != http.StatusOK || json.Unmarshal(reactivateOptionResponse.Body.Bytes(), &reactivatedOption) != nil || !reactivatedOption.Option.Active || reactivatedOption.Option.Version != 3 {
			t.Fatalf("reactivate enum option API response=%d body=%s", reactivateOptionResponse.Code, reactivateOptionResponse.Body.String())
		}

		deactivateVertical := postgres.UpdateCommerceVerticalInput{NameAr: vertical.NameAr, NameEn: vertical.NameEn, Active: false, ExpectedVersion: 1}
		disableVerticalReason := "Disable attribute test vertical"
		if result, err := postgres.UpdateCommerceVertical(ctx, db, vertical.ID, deactivateVertical, "idem-attribute-vertical-disable-"+suffix, postgres.HashCatalogVerticalUpdateRequest(vertical.ID, deactivateVertical, disableVerticalReason), closureAudit("corr-attribute-vertical-disable-"+suffix, disableVerticalReason)); err != nil || result.Vertical.Active || result.Vertical.Version != 2 {
			t.Fatalf("disable attribute owner vertical=%+v error=%v", result, err)
		}
		publicRuleResponse = api.request(t, http.MethodGet, "/dsh/public/catalog/categories/"+category.ID+"/attribute-rules", nil, "", "", 0)
		if publicRuleResponse.Code != http.StatusOK || json.Unmarshal(publicRuleResponse.Body.Bytes(), &publicRules) != nil || len(publicRules.Rules) != 0 {
			t.Fatalf("public category rules after vertical deactivation API response=%d body=%s", publicRuleResponse.Code, publicRuleResponse.Body.String())
		}
		activeOptionResponse = api.request(t, http.MethodGet, "/dsh/public/catalog/attributes/"+definition.ID+"/enum-options", nil, "", "", 0)
		if activeOptionResponse.Code != http.StatusOK || json.Unmarshal(activeOptionResponse.Body.Bytes(), &activeOptions) != nil || len(activeOptions.Options) != 0 {
			t.Fatalf("public enum options after vertical deactivation API response=%d body=%s", activeOptionResponse.Code, activeOptionResponse.Body.String())
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_registry_audit_events WHERE entity_type IN ('attribute_definition','attribute_enum_option')").Scan(&auditCount); err != nil || auditCount != 7 {
			t.Fatalf("attribute lifecycle audit event count=%d error=%v, want both creates, five successful updates, and no replay audit", auditCount, err)
		}
	})
}
