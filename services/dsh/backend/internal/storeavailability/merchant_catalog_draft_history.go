package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

// Only committed draft edits are represented; this is not published price
// history, stock movement history, or proof of checkout eligibility.
type MerchantCatalogDraftHistoryEntry struct {
	Version            int64     `json:"version"`
	PreviousPriceYER   string    `json:"previousPriceYer"`
	PriceYER           string    `json:"priceYer"`
	PreviousStockUnits int64     `json:"previousStockUnits"`
	StockUnits         int64     `json:"stockUnits"`
	CommittedAt        time.Time `json:"committedAt"`
}

type MerchantCatalogDraftHistoryPage struct {
	ActorID           string                             `json:"actorId"`
	StoreID           string                             `json:"storeId"`
	OfferID           string                             `json:"offerId"`
	Entries           []MerchantCatalogDraftHistoryEntry `json:"entries"`
	NextBeforeVersion string                             `json:"nextBeforeVersion,omitempty"`
}

const maxCatalogVersion int64 = 9007199254740991

func readMerchantCatalogDraftHistory(ctx context.Context, db *sql.DB, schema, actorID, storeID, offerID string, limit int, before int64) (MerchantCatalogDraftHistoryPage, error) {
	if !registrationPublicID.MatchString(storeID) || !registrationPublicID.MatchString(offerID) ||
		limit < 1 || limit > 50 || before < 0 || before > maxCatalogVersion {
		return MerchantCatalogDraftHistoryPage{}, ErrInvalidChange
	}
	tx, err := dbscope.Begin(ctx, db, schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "stores", "offers", "catalog_draft_edit_commands")
	if err != nil {
		return MerchantCatalogDraftHistoryPage{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	if err = requireMerchantCatalogStore(ctx, tx, actorID, storeID); err != nil {
		return MerchantCatalogDraftHistoryPage{}, err
	}
	var scopedOffer string
	err = tx.QueryRowContext(ctx, "SELECT id FROM offers WHERE store_id=$1 AND id=$2 FOR SHARE", storeID, offerID).Scan(&scopedOffer)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantCatalogDraftHistoryPage{}, ErrForbidden
	}
	if err != nil {
		return MerchantCatalogDraftHistoryPage{}, ErrStoreOwnerUnavailable
	}
	rows, err := tx.QueryContext(ctx, `SELECT result_version,old_price_yer::text,result_price_yer::text,
		old_stock_units,result_stock_units,committed_at
		FROM catalog_draft_edit_commands
		WHERE store_id=$1 AND offer_id=$2 AND ($3::bigint=0 OR result_version<$3)
		ORDER BY result_version DESC LIMIT $4`, storeID, offerID, before, limit+1)
	if err != nil {
		return MerchantCatalogDraftHistoryPage{}, ErrStoreOwnerUnavailable
	}
	defer rows.Close()
	result := MerchantCatalogDraftHistoryPage{
		ActorID: actorID, StoreID: storeID, OfferID: offerID,
		Entries: make([]MerchantCatalogDraftHistoryEntry, 0, limit),
	}
	for rows.Next() {
		var e MerchantCatalogDraftHistoryEntry
		if err = rows.Scan(&e.Version, &e.PreviousPriceYER, &e.PriceYER, &e.PreviousStockUnits, &e.StockUnits, &e.CommittedAt); err != nil ||
			e.Version < 2 || e.Version > maxCatalogVersion || e.CommittedAt.IsZero() {
			return MerchantCatalogDraftHistoryPage{}, ErrStoreOwnerUnavailable
		}
		if len(result.Entries) == limit {
			result.NextBeforeVersion = strconv.FormatInt(result.Entries[limit-1].Version, 10)
			break
		}
		e.CommittedAt = e.CommittedAt.UTC()
		result.Entries = append(result.Entries, e)
	}
	if rows.Err() != nil || rows.Close() != nil {
		return MerchantCatalogDraftHistoryPage{}, ErrStoreOwnerUnavailable
	}
	if err = tx.Commit(); err != nil {
		return MerchantCatalogDraftHistoryPage{}, ErrStoreOwnerUnavailable
	}
	return result, nil
}
