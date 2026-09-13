package catalog

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrOperatorNotActive             = errors.New("operator actor is not active")
	ErrPartnerSessionForbidden       = errors.New("an active app-partner session is required")
	ErrStoreOwnershipForbidden       = errors.New("partner does not own this store")
	ErrCentralProductNameInvalid     = errors.New("central Product name is invalid")
	ErrCentralProductBarcodeInvalid  = errors.New("central Product barcode is invalid")
	ErrCentralProductImageInvalid    = errors.New("central Product image URL is invalid")
	ErrCentralProductSellUnitInvalid = errors.New("central Product sell unit is invalid")
)

var barcodePattern = regexp.MustCompile(`^[0-9]{8,14}$`)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("catalog configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) ListProductsForPartner(ctx context.Context, accessToken, query, barcode string, limit int) ([]postgres.CentralProductRecord, error) {
	if err := s.requirePartnerSession(ctx, accessToken); err != nil {
		return nil, err
	}
	query = normalizeSearch(query)
	barcode = strings.TrimSpace(barcode)
	if barcode != "" && !barcodePattern.MatchString(barcode) {
		return nil, ErrCentralProductBarcodeInvalid
	}
	return postgres.ListCentralProducts(ctx, s.db, query, barcode, limit, true)
}

func (s *Service) ListProductsForOperator(ctx context.Context, actingActorID, query, barcode string, limit int) ([]postgres.CentralProductRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	query = normalizeSearch(query)
	barcode = strings.TrimSpace(barcode)
	if barcode != "" && !barcodePattern.MatchString(barcode) {
		return nil, ErrCentralProductBarcodeInvalid
	}
	return postgres.ListCentralProducts(ctx, s.db, query, barcode, limit, false)
}

func (s *Service) CreateCentralProduct(ctx context.Context, actingActorID string, input postgres.CentralProductInput, idempotencyKey, correlationID string) (postgres.CentralProductResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CentralProductResult{}, err
	}
	normalized, err := normalizeCentralProductInput(input)
	if err != nil {
		return postgres.CentralProductResult{}, err
	}
	return postgres.CreateCentralProduct(ctx, s.db, normalized, strings.TrimSpace(idempotencyKey), postgres.HashCentralProductCreateRequest(normalized), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) UpdateCentralProduct(ctx context.Context, actingActorID, productID string, input postgres.CentralProductUpdateInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CentralProductResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CentralProductResult{}, err
	}
	normalized, err := normalizeCentralProductUpdateInput(input)
	if err != nil {
		return postgres.CentralProductResult{}, err
	}
	productID = strings.TrimSpace(productID)
	if productID == "" || expectedVersion < 1 {
		return postgres.CentralProductResult{}, errors.New("central Product update facts are invalid")
	}
	return postgres.UpdateCentralProduct(ctx, s.db, productID, normalized, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCentralProductUpdateRequest(productID, normalized, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func normalizeCentralProductInput(input postgres.CentralProductInput) (postgres.CentralProductInput, error) {
	name, err := normalizeProductName(input.CanonicalName)
	if err != nil {
		return postgres.CentralProductInput{}, err
	}
	brand, err := normalizeOptionalText(input.Brand, 160)
	if err != nil {
		return postgres.CentralProductInput{}, err
	}
	barcode, err := normalizeBarcode(input.Barcode)
	if err != nil {
		return postgres.CentralProductInput{}, err
	}
	image, err := normalizeImageURL(input.CanonicalImageURL)
	if err != nil {
		return postgres.CentralProductInput{}, err
	}
	sellUnit := strings.ToLower(strings.TrimSpace(input.SellUnit))
	if sellUnit != "piece" && sellUnit != "kg" {
		return postgres.CentralProductInput{}, ErrCentralProductSellUnitInvalid
	}
	return postgres.CentralProductInput{CanonicalName: name, Brand: brand, Barcode: barcode, CanonicalImageURL: image, SellUnit: sellUnit}, nil
}

func normalizeCentralProductUpdateInput(input postgres.CentralProductUpdateInput) (postgres.CentralProductUpdateInput, error) {
	name, err := normalizeProductName(input.CanonicalName)
	if err != nil {
		return postgres.CentralProductUpdateInput{}, err
	}
	brand, err := normalizeOptionalText(input.Brand, 160)
	if err != nil {
		return postgres.CentralProductUpdateInput{}, err
	}
	barcode, err := normalizeBarcode(input.Barcode)
	if err != nil {
		return postgres.CentralProductUpdateInput{}, err
	}
	image, err := normalizeImageURL(input.CanonicalImageURL)
	if err != nil {
		return postgres.CentralProductUpdateInput{}, err
	}
	return postgres.CentralProductUpdateInput{CanonicalName: name, Brand: brand, Barcode: barcode, CanonicalImageURL: image, Active: input.Active}, nil
}

func normalizeProductName(value string) (string, error) {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if utf8.RuneCountInString(normalized) < 1 || utf8.RuneCountInString(normalized) > 160 {
		return "", ErrCentralProductNameInvalid
	}
	return normalized, nil
}

func normalizeOptionalText(value *string, max int) (*string, error) {
	if value == nil {
		return nil, nil
	}
	normalized := strings.Join(strings.Fields(strings.TrimSpace(*value)), " ")
	if normalized == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(normalized) > max {
		return nil, errors.New("central Product optional text is invalid")
	}
	return &normalized, nil
}

func normalizeBarcode(value *string) (*string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	normalized := strings.TrimSpace(*value)
	if !barcodePattern.MatchString(normalized) {
		return nil, ErrCentralProductBarcodeInvalid
	}
	return &normalized, nil
}

func normalizeImageURL(value *string) (*string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	normalized := strings.TrimSpace(*value)
	parsed, err := url.ParseRequestURI(normalized)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return nil, ErrCentralProductImageInvalid
	}
	return &normalized, nil
}

func normalizeSearch(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}
