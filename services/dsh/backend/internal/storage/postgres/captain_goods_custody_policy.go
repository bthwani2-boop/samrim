package postgres

import (
	"context"
	"database/sql"
	"errors"
)

// This is a merchandise-custody limit, not COD collateral or a wallet hold.
// Both acceptance and physical pickup recheck the policy in the same DSH tx.
var ErrCaptainGoodsCustodyLimit = errors.New("captain goods custody exposure exceeds approved policy")

func requireCaptainGoodsCustodyLimitTx(ctx context.Context, tx *sql.Tx, orderID, captainActorID string) error {
	var mode string
	var merchandise, total int64
	if err := tx.QueryRowContext(ctx,
		"SELECT fulfillment_mode,subtotal_amount_minor,total_amount_minor FROM dsh.commerce_orders WHERE id=$1",
		orderID).Scan(&mode, &merchandise, &total); err != nil {
		return err
	}
	if mode != "BTHWANI_CAPTAIN" {
		return nil
	} // Store couriers are the merchant's risk.
	if merchandise <= 0 {
		merchandise = total
	} // Preserve historical orders lacking subtotal snapshots.
	if merchandise <= 0 {
		return ErrCaptainGoodsCustodyLimit
	}
	var singleCap, concurrentCap int64
	var state string
	err := tx.QueryRowContext(ctx, `SELECT single_order_cap_minor,concurrent_cap_minor,state
  FROM dsh.captain_goods_custody_policies WHERE id='platform' FOR SHARE`).Scan(&singleCap, &concurrentCap, &state)
	if err != nil {
		return err
	}
	if state != "ACTIVE" || singleCap <= 0 || concurrentCap < singleCap || merchandise > singleCap {
		return ErrCaptainGoodsCustodyLimit
	}
	var otherCustody int64
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE
   WHEN o.subtotal_amount_minor>0 THEN o.subtotal_amount_minor
   ELSE o.total_amount_minor END),0)
 FROM dsh.captain_assignments a
 JOIN dsh.commerce_orders o ON o.id=a.order_id
 WHERE a.captain_actor_id=$1 AND a.order_id<>$2
 AND a.state IN ('assigned','in_custody','delivery_failed')
 AND o.fulfillment_mode='BTHWANI_CAPTAIN'`, captainActorID, orderID).Scan(&otherCustody)
	if err != nil {
		return err
	}
	if otherCustody < 0 || merchandise > concurrentCap || otherCustody > concurrentCap-merchandise {
		return ErrCaptainGoodsCustodyLimit
	}
	return nil
}
