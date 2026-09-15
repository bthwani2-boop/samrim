package postgres

import (
	"context"
	"errors"
	"math/big"
	"strings"
)

// ValidateCatalogModifierSelection is the single readback/validation path for
// modifier selections. It returns the canonical option rows so callers can
// calculate the amount and write immutable transaction snapshots.
func ValidateCatalogModifierSelection(ctx context.Context, db queryer, offerID string, optionIDs []string) ([]CatalogModifierOptionRecord, int64, error) {
	groups, err := listOfferModifierGroups(ctx, db, strings.TrimSpace(offerID))
	if err != nil {
		return nil, 0, err
	}
	groupByOption := make(map[string]CatalogModifierGroupRecord)
	optionByID := make(map[string]CatalogModifierOptionRecord)
	for _, group := range groups {
		for _, option := range group.Options {
			groupByOption[option.ID] = group
			optionByID[option.ID] = option
		}
	}
	selected := make([]CatalogModifierOptionRecord, 0, len(optionIDs))
	counts := make(map[string]int)
	total := new(big.Int)
	seen := make(map[string]struct{}, len(optionIDs))
	for _, rawID := range optionIDs {
		optionID := strings.TrimSpace(rawID)
		if optionID == "" {
			return nil, 0, ErrCartModifierInvalid
		}
		if _, exists := seen[optionID]; exists {
			return nil, 0, ErrCartModifierInvalid
		}
		seen[optionID] = struct{}{}
		option, exists := optionByID[optionID]
		group, groupExists := groupByOption[optionID]
		if !exists || !groupExists || !option.Availability || !group.Active {
			return nil, 0, ErrCartModifierInvalid
		}
		counts[group.ID]++
		if counts[group.ID] > group.MaxSelections {
			return nil, 0, ErrCartModifierInvalid
		}
		total.Add(total, big.NewInt(option.PriceDeltaMinor))
		selected = append(selected, option)
	}
	for _, group := range groups {
		count := counts[group.ID]
		if count < group.MinSelections || count > group.MaxSelections {
			return nil, 0, ErrCartModifierInvalid
		}
	}
	if !total.IsInt64() || total.Sign() < 0 {
		return nil, 0, ErrCartModifierInvalid
	}
	return selected, total.Int64(), nil
}

func CalculateCatalogModifierAmount(deltaMinor, quantity int64) (int64, error) {
	if deltaMinor < 0 || quantity <= 0 {
		return 0, ErrCartModifierInvalid
	}
	amount := new(big.Int).Mul(big.NewInt(deltaMinor), big.NewInt(quantity))
	if !amount.IsInt64() {
		return 0, ErrCartModifierInvalid
	}
	return amount.Int64(), nil
}

func AddCatalogModifierAmount(baseMinor, deltaMinor, quantity int64) (int64, error) {
	modifierAmount, err := CalculateCatalogModifierAmount(deltaMinor, quantity)
	if err != nil {
		return 0, err
	}
	total := new(big.Int).Add(big.NewInt(baseMinor), big.NewInt(modifierAmount))
	if baseMinor <= 0 || !total.IsInt64() || total.Sign() <= 0 {
		return 0, errors.New("catalog line amount is invalid")
	}
	return total.Int64(), nil
}
