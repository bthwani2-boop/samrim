package postgres

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Read-only driver: the attached modifier group was deactivated by the partner,
// but the previously chosen option remains in an otherwise readable cart line.
type cartReviewConnector struct{ conn *cartReviewConn }

func (c cartReviewConnector) Connect(context.Context) (driver.Conn, error) { return c.conn, nil }
func (c cartReviewConnector) Driver() driver.Driver                        { return removedLineDriver{} }

type cartReviewConn struct {
	selectedOptions string
	customerVisible bool
	inventoryPolicy string
	onHand          int64
	reserved        int64
	maximum         int64
	minimum         int64
	step            int64
	lineQueries     int
	groupQueries    int
}

func (c *cartReviewConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}
func (c *cartReviewConn) Close() error              { return nil }
func (c *cartReviewConn) Begin() (driver.Tx, error) { return removedLineTx{}, nil }

func (c *cartReviewConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM dsh.commerce_cart_lines l"):
		if !strings.Contains(query, "dsh.catalog_customer_visible_offers") {
			return nil, errors.New("cart read must check the canonical customer visibility view")
		}
		c.lineQueries++
		now := time.Now().UTC()
		return &removedLineRows{
			columns: []string{"id", "cart_id", "store_offer_id", "variant_id", "product_id", "canonical_name", "title", "measurement_kind", "base_unit", "pricing_basis", "quantity_policy", "quantity_min_base_units", "quantity_max_base_units", "quantity_step_base_units", "pricing_unit_base_units", "quantity_base_units", "selected_modifier_option_ids", "price_minor", "currency", "version", "inventory_policy", "inventory_on_hand_base_units", "inventory_reserved_base_units", "customer_visible", "created_at", "updated_at"},
			values:  [][]driver.Value{{"line-1", "cart-1", "offer-1", "variant-1", "product-1", "منتج", "حجم", "DISCRETE", "COUNT", "PER_UNIT", "DISCRETE", c.minimum, c.maximum, c.step, int64(1), int64(3), c.selectedOptions, int64(100), "YER", int64(1), c.inventoryPolicy, c.onHand, c.reserved, c.customerVisible, now, now}},
		}, nil
	case strings.Contains(query, "FROM dsh.catalog_store_offer_modifier_groups"):
		c.groupQueries++
		// A formerly selected modifier group is now inactive and hidden
		// by the canonical WHERE g.active=true predicate.
		return &removedLineRows{columns: []string{"id", "store_id", "name_ar", "required", "min_selections", "max_selections", "active", "version"}}, nil
	default:
		return nil, fmt.Errorf("unexpected SQL in cart review fixture: %s", query)
	}
}

func TestCartReadKeepsInvalidModifierLineRemovableWithoutQuotingPrice(t *testing.T) {
	for _, tc := range []struct {
		name            string
		selected        string
		customerVisible bool
		inventoryPolicy string
		onHand          int64
		reserved        int64
		minimum         int64
		maximum         int64
		step            int64
		requiresReview  bool
	}{
		{name: "former option group is now inactive", selected: "{option-1}", customerVisible: true, inventoryPolicy: "AVAILABILITY_ONLY", minimum: 1, maximum: 100, step: 1, requiresReview: true},
		{name: "valid cart without attached modifier groups", selected: "{}", customerVisible: true, inventoryPolicy: "AVAILABILITY_ONLY", minimum: 1, maximum: 100, step: 1, requiresReview: false},
		{name: "offer no longer customer visible", selected: "{}", customerVisible: false, inventoryPolicy: "AVAILABILITY_ONLY", minimum: 1, maximum: 100, step: 1, requiresReview: true},
		{name: "offer maximum reduced below selected quantity", selected: "{}", customerVisible: true, inventoryPolicy: "AVAILABILITY_ONLY", minimum: 1, maximum: 2, step: 1, requiresReview: true},
		{name: "offer quantity step changed", selected: "{}", customerVisible: true, inventoryPolicy: "AVAILABILITY_ONLY", minimum: 2, maximum: 100, step: 2, requiresReview: true},
		{name: "tracked inventory covers cart", selected: "{}", customerVisible: true, inventoryPolicy: "QUANTITY_ON_HAND", onHand: 5, reserved: 2, minimum: 1, maximum: 100, step: 1, requiresReview: false},
		{name: "tracked inventory below selected quantity", selected: "{}", customerVisible: true, inventoryPolicy: "QUANTITY_ON_HAND", onHand: 2, reserved: 0, minimum: 1, maximum: 100, step: 1, requiresReview: true},
		{name: "other orders already reserved stock", selected: "{}", customerVisible: true, inventoryPolicy: "QUANTITY_ON_HAND", onHand: 4, reserved: 2, minimum: 1, maximum: 100, step: 1, requiresReview: true},
		{name: "untracked inventory must not reject cart", selected: "{}", customerVisible: true, inventoryPolicy: "AVAILABILITY_ONLY", onHand: 0, reserved: 0, minimum: 1, maximum: 100, step: 1, requiresReview: false},
		{name: "invalid inventory policy is not payable", selected: "{}", customerVisible: true, inventoryPolicy: "UNKNOWN", minimum: 1, maximum: 100, step: 1, requiresReview: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := &cartReviewConn{selectedOptions: tc.selected, customerVisible: tc.customerVisible, inventoryPolicy: tc.inventoryPolicy, onHand: tc.onHand, reserved: tc.reserved, minimum: tc.minimum, maximum: tc.maximum, step: tc.step}
			db := sql.OpenDB(cartReviewConnector{conn: conn})
			t.Cleanup(func() { _ = db.Close() })
			lines, err := listCartLines(context.Background(), db, "cart-1")
			if err != nil {
				t.Fatalf("read cart lines: %v", err)
			}
			if len(lines) != 1 || lines[0].RequiresReview != tc.requiresReview {
				t.Fatalf("lines=%+v, requiresReview want %t", lines, tc.requiresReview)
			}
			if lines[0].LineAmountMinor != 300 || lines[0].UnitPriceMinor != 100 {
				t.Fatalf("base price facts not preserved: %+v", lines[0])
			}
			if lines[0].SelectedModifiers == nil {
				t.Fatal("response must preserve the non-null modifier array contract")
			}
			if conn.lineQueries != 1 || conn.groupQueries != 1 {
				t.Fatalf("unexpected read queries: lines=%d groups=%d", conn.lineQueries, conn.groupQueries)
			}
		})
	}
}
