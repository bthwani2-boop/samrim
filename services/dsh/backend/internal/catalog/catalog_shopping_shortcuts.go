package catalog

import (
	"context"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Operator authority is the same Catalog permission used for categories and
// internal commercial Store types. This is only a presentation registry.
func (s *Service) ListShoppingShortcutsForOperator(ctx context.Context, actingActorID, verticalID string) ([]postgres.ShoppingShortcutRecord, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return postgres.ListShoppingShortcuts(ctx, s.db, strings.TrimSpace(verticalID), false)
}

func normalizeShoppingShortcut(input postgres.ShoppingShortcutInput, reason string) (postgres.ShoppingShortcutInput, string, error) {
	input.ID = strings.ToLower(strings.TrimSpace(input.ID))
	input.VerticalID = strings.ToLower(strings.TrimSpace(input.VerticalID))
	input.TitleAr = strings.Join(strings.Fields(input.TitleAr), " ")
	reason = strings.Join(strings.Fields(reason), " ")
	if (input.ID != "" && !verticalIDPattern.MatchString(input.ID)) ||
		!verticalIDPattern.MatchString(input.VerticalID) ||
		!validRegistryName(input.TitleAr) || !utf8.ValidString(input.TitleAr) ||
		input.Ordinal < 0 || input.Ordinal > 9999 || input.ExpectedVersion < 0 ||
		len(reason) < 5 || len(reason) > 500 {
		return input, reason, postgres.ErrShoppingShortcutInvalid
	}
	normalize := func(ids []string) ([]string, bool) {
		seen := map[string]bool{}
		values := make([]string, 0, len(ids))
		for _, raw := range ids {
			id := strings.ToLower(strings.TrimSpace(raw))
			if !verticalIDPattern.MatchString(id) || seen[id] {
				return nil, false
			}
			seen[id] = true
			values = append(values, id)
		}
		sort.Strings(values)
		return values, true
	}
	var ok bool
	input.StoreTypeIDs, ok = normalize(input.StoreTypeIDs)
	if !ok {
		return input, reason, postgres.ErrShoppingShortcutInvalid
	}
	input.CategoryIDs, ok = normalize(input.CategoryIDs)
	if !ok || len(input.StoreTypeIDs)+len(input.CategoryIDs) == 0 ||
		len(input.StoreTypeIDs)+len(input.CategoryIDs) > 25 {
		return input, reason, postgres.ErrShoppingShortcutInvalid
	}
	return input, reason, nil
}

func (s *Service) MutateShoppingShortcut(ctx context.Context, actingActorID string,
	input postgres.ShoppingShortcutInput, key, correlation, reason string) (postgres.ShoppingShortcutResult, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.ShoppingShortcutResult{}, err
	}
	normalized, normalizedReason, err := normalizeShoppingShortcut(input, reason)
	if err != nil {
		return postgres.ShoppingShortcutResult{}, err
	}
	if (normalized.ExpectedVersion == 0 && normalized.ID != "") ||
		(normalized.ExpectedVersion > 0 && normalized.ID == "") ||
		strings.TrimSpace(correlation) == "" {
		return postgres.ShoppingShortcutResult{}, postgres.ErrShoppingShortcutInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID),
		CorrelationID: strings.TrimSpace(correlation), Reason: normalizedReason}
	return postgres.MutateShoppingShortcut(ctx, s.db, normalized, strings.TrimSpace(key),
		postgres.HashShoppingShortcutMutation(normalized, normalizedReason), audit)
}
