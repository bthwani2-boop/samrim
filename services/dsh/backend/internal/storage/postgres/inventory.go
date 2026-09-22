package postgres

import (
	"context"
	"database/sql"
	"errors"
)

func reserveCatalogOfferInventoryTx(ctx context.Context, tx *sql.Tx, offerID string, quantity int64) (int64, error) {
	if quantity <= 0 {
		return 0, ErrCatalogInventoryInvalid
	}
	var policy string
	var onHand, reserved int64
	err := tx.QueryRowContext(ctx, "SELECT inventory_policy,inventory_on_hand_base_units,inventory_reserved_base_units FROM dsh.catalog_store_offers WHERE id=$1 FOR UPDATE", offerID).Scan(&policy, &onHand, &reserved)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrCatalogOfferNotFound
	}
	if err != nil {
		return 0, err
	}
	if policy == "AVAILABILITY_ONLY" {
		return 0, nil
	}
	if policy != "QUANTITY_ON_HAND" || onHand-reserved < quantity {
		return 0, ErrCatalogInventoryInsufficient
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET inventory_reserved_base_units=inventory_reserved_base_units+$2,updated_at=clock_timestamp() WHERE id=$1", offerID, quantity); err != nil {
		return 0, err
	}
	return quantity, nil
}

func releaseOrderInventoryTx(ctx context.Context, tx *sql.Tx, orderID string) error {
	rows, err := tx.QueryContext(ctx, "SELECT id,store_offer_id,inventory_reserved_base_units FROM dsh.commerce_order_lines WHERE order_id=$1 AND inventory_reserved_base_units>0 FOR UPDATE", orderID)
	if err != nil {
		return err
	}
	lines := make([]inventoryReservationLine, 0)
	for rows.Next() {
		var line inventoryReservationLine
		if err := rows.Scan(&line.lineID, &line.offerID, &line.quantity); err != nil {
			_ = rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, line := range lines {
		result, err := tx.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET inventory_reserved_base_units=inventory_reserved_base_units-$2,updated_at=clock_timestamp() WHERE id=$1 AND inventory_reserved_base_units >= $2", line.offerID, line.quantity)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return ErrCatalogInventoryInvalid
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_order_lines SET inventory_reserved_base_units=0 WHERE id=$1", line.lineID); err != nil {
			return err
		}
	}
	return nil
}

func consumeOrderInventoryTx(ctx context.Context, tx *sql.Tx, orderID string) error {
	rows, err := tx.QueryContext(ctx, "SELECT id,store_offer_id,inventory_reserved_base_units FROM dsh.commerce_order_lines WHERE order_id=$1 AND inventory_reserved_base_units>0 FOR UPDATE", orderID)
	if err != nil {
		return err
	}
	lines := make([]inventoryReservationLine, 0)
	for rows.Next() {
		var line inventoryReservationLine
		if err := rows.Scan(&line.lineID, &line.offerID, &line.quantity); err != nil {
			_ = rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, line := range lines {
		result, err := tx.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET inventory_reserved_base_units=inventory_reserved_base_units-$2,inventory_on_hand_base_units=inventory_on_hand_base_units-$2,updated_at=clock_timestamp() WHERE id=$1 AND inventory_reserved_base_units >= $2 AND inventory_on_hand_base_units >= $2", line.offerID, line.quantity)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected != 1 {
			return ErrCatalogInventoryInvalid
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_order_lines SET inventory_reserved_base_units=0 WHERE id=$1", line.lineID); err != nil {
			return err
		}
	}
	return nil
}

type inventoryReservationLine struct {
	lineID, offerID string
	quantity        int64
}
