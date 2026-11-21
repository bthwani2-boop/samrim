package discovery

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

type offerEstimate struct {
	StoreID     string `json:"storeId"`
	OfferID     string `json:"offerId"`
	VariantID   string `json:"variantId"`
	Quantity    int64  `json:"quantity"`
	UnitYER     string `json:"unitYer"`
	SubtotalYER string `json:"subtotalYer"`
}

func (s *Server) estimateOffer(ctx context.Context, w http.ResponseWriter, r *http.Request, storeID, offerID string) {
	parameters, err := url.ParseQuery(r.URL.RawQuery)
	rawQuantity := parameters.Get("quantity")
	quantity, quantityErr := strconv.ParseInt(rawQuantity, 10, 32)
	if err != nil || quantityErr != nil || quantity < 1 || strconv.FormatInt(quantity, 10) != rawQuantity ||
		len(parameters) != 1 || len(parameters["quantity"]) != 1 || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		errorJSON(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	tx, err := s.Owner.viewTx(ctx)
	if err != nil {
		errorJSON(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	if _, err := s.visibleStore(ctx, tx, storeID); err != nil {
		estimateReadError(w, err)
		return
	}
	result := offerEstimate{StoreID: storeID, OfferID: offerID, Quantity: quantity}
	var available bool
	query := `SELECT o.variant_id, o.price_yer::text, (o.price_yer::numeric * $3::integer)::text, o.stock_units >= $3::integer` +
		visibleOffersSQL + ` AND o.id=$2`
	if err := tx.QueryRowContext(ctx, query, storeID, offerID, quantity).
		Scan(&result.VariantID, &result.UnitYER, &result.SubtotalYER, &available); err != nil {
		estimateReadError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		estimateReadError(w, err)
		return
	}
	if !available {
		errorJSON(w, http.StatusConflict, "INSUFFICIENT_AVAILABLE_QUANTITY")
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func estimateReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		errorJSON(w, http.StatusNotFound, "NOT_FOUND")
		return
	}
	errorJSON(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
}
