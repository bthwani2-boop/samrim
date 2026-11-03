package storepublication

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// SearchPublicCatalog applies the same live Partner Identity and Store-specific
// WLT agreement gates used by customer Store discovery. DSH's catalog SQL alone
// cannot know when either external authority revokes eligibility.
// The deadline also bounds PostgreSQL scan work for LIKE patterns without
// extractable trigrams; raw-offer and batch caps cannot bound database work.
func (s *Service) SearchPublicCatalog(ctx context.Context, serviceCityID, verticalID, categoryID, query string, limit int, cursor string, shortcutScope ...string) (postgres.PublicCatalogSearchRecord, error) {
	const searchBudget = 8 * time.Second // cooperative cancellation; no strict wall-clock guarantee
	boundedCtx, cancel := context.WithTimeout(ctx, searchBudget)
	defer cancel()
	return collectEligiblePublicCatalogOffers(boundedCtx, limit, cursor,
		func(ctx context.Context, nextLimit int, nextCursor string) (postgres.PublicCatalogSearchRecord, error) {
			return postgres.SearchPublicCatalog(ctx, s.db, serviceCityID, verticalID, categoryID, query, nextLimit, nextCursor, shortcutScope...)
		},
		func(ctx context.Context, storeID string) (bool, error) {
			_, err := s.ReadPublished(ctx, storeID, serviceCityID)
			if errors.Is(err, postgres.ErrStoreNotFound) {
				return false, nil
			}
			if err != nil {
				return false, err
			}
			return true, nil
		},
	)
}

// Scan raw product cursor pages until enough *eligible* offers have been found.
// Bounded scanning prevents a large collection of ineligible Stores from
// causing unbounded calls to Identity/WLT; a continuation cursor is preserved
// when that budget is exhausted rather than claiming the search is exhausted.
func collectEligiblePublicCatalogOffers(
	ctx context.Context,
	limit int,
	initialCursor string,
	fetch func(context.Context, int, string) (postgres.PublicCatalogSearchRecord, error),
	storeEligible func(context.Context, string) (bool, error),
) (postgres.PublicCatalogSearchRecord, error) {
	if limit < 1 || limit > 50 {
		return postgres.PublicCatalogSearchRecord{}, errors.New("public catalog search page limit must be between 1 and 50")
	}
	const maxRawOffers = 200
	const maxBatches = 20
	result := postgres.PublicCatalogSearchRecord{Offers: []postgres.CatalogStoreOfferRecord{}}
	// An external authority can return 404 after context cancellation. Never
	// treat a partial set of already-authorized offers as a successful page.
	finish := func() (postgres.PublicCatalogSearchRecord, error) {
		if err := ctx.Err(); err != nil {
			return postgres.PublicCatalogSearchRecord{}, err
		}
		return result, nil
	}
	checked := make(map[string]bool)
	cursor := initialCursor
	scanned := 0
	for batch := 0; batch < maxBatches; batch++ {
		rawLimit := min(limit-len(result.Offers), maxRawOffers-scanned)
		if rawLimit <= 0 {
			return finish()
		}
		raw, err := fetch(ctx, rawLimit, cursor)
		if err != nil {
			return postgres.PublicCatalogSearchRecord{}, err
		}
		scanned += len(raw.Offers)
		for _, offer := range raw.Offers {
			id := strings.TrimSpace(offer.StoreID)
			if id == "" {
				continue
			}
			allowed, found := checked[id]
			if !found {
				allowed, err = storeEligible(ctx, id)
				if err != nil {
					return postgres.PublicCatalogSearchRecord{}, err
				}
				checked[id] = allowed
			}
			if allowed {
				result.Offers = append(result.Offers, offer)
			}
		}
		result.NextCursor = raw.NextCursor
		if raw.NextCursor != nil && (*raw.NextCursor == "" || *raw.NextCursor == cursor) {
			return postgres.PublicCatalogSearchRecord{}, fmt.Errorf("public catalog search cursor did not advance")
		}
		if len(result.Offers) >= limit || raw.NextCursor == nil || scanned >= maxRawOffers || batch+1 >= maxBatches {
			return finish()
		}
		cursor = *raw.NextCursor
	}
	return finish()
}
