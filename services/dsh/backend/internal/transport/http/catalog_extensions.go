package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type catalogAttributeValueRequest struct {
	AttributeID     string  `json:"attributeId"`
	ValueKind       string  `json:"valueKind"`
	TextValue       *string `json:"textValue"`
	IntegerValue    *int64  `json:"integerValue"`
	DecimalValue    *string `json:"decimalValue"`
	BooleanValue    *bool   `json:"booleanValue"`
	EnumValue       *string `json:"enumValue"`
	DateValue       *string `json:"dateValue"`
	MeasurementUnit *string `json:"measurementUnit"`
}

type catalogProductCreateRequest struct {
	contract.CreateCatalogProductRequest
	AttributeValues        []catalogAttributeValueRequest `json:"attributeValues"`
	VariantAttributeValues []catalogAttributeValueRequest `json:"variantAttributeValues"`
}

func catalogAttributeInputs(values []catalogAttributeValueRequest) []postgres.CatalogAttributeValueInput {
	inputs := make([]postgres.CatalogAttributeValueInput, 0, len(values))
	for _, value := range values {
		inputs = append(inputs, postgres.CatalogAttributeValueInput{AttributeID: value.AttributeID, ValueKind: value.ValueKind, TextValue: value.TextValue, IntegerValue: value.IntegerValue, DecimalValue: value.DecimalValue, BooleanValue: value.BooleanValue, EnumValue: value.EnumValue, DateValue: value.DateValue, MeasurementUnit: value.MeasurementUnit})
	}
	return inputs
}

func (s *CatalogServer) listAttributeDefinitions(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	verticalID := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	activeOnly := r.URL.Query().Get("includeInactive") != "true"
	items, err := s.service.ListAttributeDefinitionsForOperator(r.Context(), acting, verticalID, activeOnly)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogAttributeDefinition, 0, len(items))
	for _, item := range items {
		values = append(values, toCatalogAttributeDefinition(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogAttributeDefinitionListResponse{Definitions: values})
}

func (s *CatalogServer) listPublicCategoryAttributeRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.service.ReadPublicAttributeRules(r.Context(), r.PathValue("categoryId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogAttributeRule, 0, len(rules))
	for _, item := range rules {
		values = append(values, toCatalogAttributeRule(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogAttributeRuleListResponse{Rules: values})
}

func (s *CatalogServer) listCategoryAttributeRules(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	rules, err := s.service.ReadAttributeRules(r.Context(), acting, r.PathValue("categoryId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogAttributeRule, 0, len(rules))
	for _, item := range rules {
		values = append(values, toCatalogAttributeRule(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogAttributeRuleListResponse{Rules: values})
}

func (s *CatalogServer) listPublicAttributeEnumOptions(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListPublicAttributeEnumOptions(r.Context(), r.PathValue("attributeId"))
	if err != nil { writeCatalogError(w, err); return }
	values := make([]contract.CatalogAttributeEnumOption, 0, len(items))
	for _, item := range items { values = append(values, contract.CatalogAttributeEnumOption{AttributeID:item.AttributeID, OptionValue:item.OptionValue, Active:item.Active, Ordinal:item.Ordinal}) }
	writeJSON(w, http.StatusOK, contract.CatalogAttributeEnumOptionListResponse{Options: values})
}

func (s *CatalogServer) listAttributeEnumOptions(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	items, err := s.service.ListAttributeEnumOptions(r.Context(), acting, r.PathValue("attributeId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogAttributeEnumOption, 0, len(items))
	for _, item := range items {
		values = append(values, contract.CatalogAttributeEnumOption{AttributeID: item.AttributeID, OptionValue: item.OptionValue, Active: item.Active, Ordinal: item.Ordinal})
	}
	writeJSON(w, http.StatusOK, contract.CatalogAttributeEnumOptionListResponse{Options: values})
}

func (s *CatalogServer) createAttributeEnumOption(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, _, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateCatalogAttributeEnumOptionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := s.service.CreateAttributeEnumOption(r.Context(), acting, r.PathValue("attributeId"), postgres.CatalogAttributeEnumOptionInput{OptionValue: input.OptionValue, Active: input.Active, Ordinal: input.Ordinal}, idempotency)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.CatalogAttributeEnumOptionResponse{Option: contract.CatalogAttributeEnumOption{AttributeID: item.AttributeID, OptionValue: item.OptionValue, Active: item.Active, Ordinal: item.Ordinal}, IdempotentReplay: replayed})
}

func (s *CatalogServer) createAttributeDefinition(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, _, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateCatalogAttributeDefinitionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := s.service.CreateAttributeDefinition(r.Context(), acting, postgres.CatalogAttributeDefinitionInput{ID: input.ID, VerticalID: input.VerticalID, Code: input.Code, NameAr: input.NameAr, ValueKind: input.ValueKind, Active: input.Active}, idempotency)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.CatalogAttributeDefinitionResponse{Definition: toCatalogAttributeDefinition(item), IdempotentReplay: replayed})
}

func (s *CatalogServer) upsertProductAttribute(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input catalogAttributeValueRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	err := s.service.UpsertProductAttribute(r.Context(), acting, r.PathValue("productId"), postgres.CatalogAttributeValueInput{AttributeID: r.PathValue("attributeId"), ValueKind: input.ValueKind, TextValue: input.TextValue, IntegerValue: input.IntegerValue, DecimalValue: input.DecimalValue, BooleanValue: input.BooleanValue, EnumValue: input.EnumValue, DateValue: input.DateValue, MeasurementUnit: input.MeasurementUnit})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	product, err := s.service.ReadCatalogProduct(r.Context(), acting, r.PathValue("productId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductResponse{Product: toCatalogProduct(product)})
}

func (s *CatalogServer) upsertVariantAttribute(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input catalogAttributeValueRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	err := s.service.UpsertVariantAttribute(r.Context(), acting, r.PathValue("variantId"), postgres.CatalogAttributeValueInput{AttributeID: r.PathValue("attributeId"), ValueKind: input.ValueKind, TextValue: input.TextValue, IntegerValue: input.IntegerValue, DecimalValue: input.DecimalValue, BooleanValue: input.BooleanValue, EnumValue: input.EnumValue, DateValue: input.DateValue, MeasurementUnit: input.MeasurementUnit})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	variant, err := s.service.ReadCatalogVariant(r.Context(), acting, r.PathValue("variantId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogVariantResponse{Variant: toCatalogVariant(variant)})
}

func (s *CatalogServer) upsertCategoryAttributeRule(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.UpsertCatalogAttributeRuleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.UpsertCategoryAttributeRule(r.Context(), acting, correlation, input.Reason, idempotency, input.ExpectedVersion, postgres.CatalogAttributeRuleRecord{CategoryID: r.PathValue("categoryId"), AttributeID: r.PathValue("attributeId"), Required: input.Required, Filterable: input.Filterable, VariantAxis: input.VariantAxis}); err != nil {
		writeCatalogError(w, err)
		return
	}
	rules, err := s.service.ReadAttributeRules(r.Context(), acting, r.PathValue("categoryId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogAttributeRule, 0, len(rules))
	for _, item := range rules {
		values = append(values, toCatalogAttributeRule(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogAttributeRuleListResponse{Rules: values})
}

func (s *CatalogServer) createModifierGroup(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateCatalogModifierGroupRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.service.CreateModifierGroup(r.Context(), bearerToken(r), r.PathValue("storeId"), postgres.CatalogModifierGroupInput{NameAr: input.NameAr, Required: input.Required, MinSelections: input.MinSelections, MaxSelections: input.MaxSelections, Active: input.Active})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	_ = correlation
	_ = idempotency
	writeJSON(w, http.StatusCreated, contract.CatalogModifierGroupResponse{Group: toCatalogModifierGroup(item)})
}

func (s *CatalogServer) createModifierOption(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateCatalogModifierOptionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.service.CreateModifierOption(r.Context(), bearerToken(r), r.PathValue("storeId"), postgres.CatalogModifierOptionInput{GroupID: r.PathValue("groupId"), NameAr: input.NameAr, PriceDeltaMinor: int64(input.PriceDeltaMinor), Availability: input.Availability, Ordinal: input.Ordinal})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	_ = correlation
	_ = idempotency
	writeJSON(w, http.StatusCreated, contract.CatalogModifierOptionResponse{Option: toCatalogModifierOption(item)})
}

func (s *CatalogServer) attachModifierGroup(w http.ResponseWriter, r *http.Request) {
	_, _, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.AttachCatalogOrdinalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.AttachModifierGroup(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("offerId"), r.PathValue("groupId"), input.Ordinal); err != nil {
		writeCatalogError(w, err)
		return
	}
	item, err := s.service.ReadOfferForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("offerId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogStoreOfferResponse{Offer: toStoreOffer(item)})
}

func (s *CatalogServer) createStorefrontSection(w http.ResponseWriter, r *http.Request) {
	_, _, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateCatalogStorefrontSectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var nameEn *string
	if strings.TrimSpace(input.NameEn) != "" {
		value := input.NameEn
		nameEn = &value
	}
	item, err := s.service.CreateStorefrontSection(r.Context(), bearerToken(r), r.PathValue("storeId"), postgres.CatalogStorefrontSectionInput{NameAr: input.NameAr, NameEn: nameEn, Ordinal: input.Ordinal, Active: input.Active})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, contract.CatalogStorefrontSectionResponse{Section: toCatalogStorefrontSection(item)})
}

func (s *CatalogServer) attachOfferToSection(w http.ResponseWriter, r *http.Request) {
	_, _, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.AttachCatalogOrdinalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.AttachOfferToSection(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("sectionId"), r.PathValue("offerId"), input.Ordinal); err != nil {
		writeCatalogError(w, err)
		return
	}
	item, err := s.service.ReadStorefrontSection(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("sectionId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogStorefrontSectionResponse{Section: toCatalogStorefrontSection(item)})
}

func toCatalogAttributeDefinition(item postgres.CatalogAttributeDefinitionRecord) contract.CatalogAttributeDefinition {
	return contract.CatalogAttributeDefinition{ID: item.ID, VerticalID: item.VerticalID, Code: item.Code, NameAr: item.NameAr, ValueKind: item.ValueKind, Active: item.Active, Filterable: item.Filterable, Version: item.Version}
}

func toCatalogAttributeRule(item postgres.CatalogAttributeRuleRecord) contract.CatalogAttributeRule {
	return contract.CatalogAttributeRule{CategoryID: item.CategoryID, AttributeID: item.AttributeID, Code: item.Code, NameAr: item.NameAr, ValueKind: item.ValueKind, Required: item.Required, Filterable: item.Filterable, VariantAxis: item.VariantAxis, Version: item.Version}
}

func toCatalogModifierGroup(item postgres.CatalogModifierGroupRecord) contract.CatalogModifierGroup {
	return contract.CatalogModifierGroup{ID: item.ID, StoreID: item.StoreID, NameAr: item.NameAr, Required: item.Required, MinSelections: item.MinSelections, MaxSelections: item.MaxSelections, Active: item.Active, Version: item.Version, Options: toCatalogModifierOptions(item.Options)}
}

func toCatalogModifierOptions(items []postgres.CatalogModifierOptionRecord) []contract.CatalogModifierOption {
	values := make([]contract.CatalogModifierOption, 0, len(items))
	for _, item := range items {
		values = append(values, toCatalogModifierOption(item))
	}
	return values
}

func toCatalogModifierOption(item postgres.CatalogModifierOptionRecord) contract.CatalogModifierOption {
	return contract.CatalogModifierOption{ID: item.ID, GroupID: item.GroupID, NameAr: item.NameAr, PriceDeltaMinor: int(item.PriceDeltaMinor), Availability: item.Availability, Ordinal: item.Ordinal, Version: item.Version}
}

func toCatalogStorefrontSection(item postgres.CatalogStorefrontSectionRecord) contract.CatalogStorefrontSection {
	nameEn := ""
	if item.NameEn != nil {
		nameEn = *item.NameEn
	}
	return contract.CatalogStorefrontSection{ID: item.ID, StoreID: item.StoreID, NameAr: item.NameAr, NameEn: nameEn, Ordinal: item.Ordinal, Active: item.Active, Version: item.Version, OfferIds: item.OfferIDs, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
