package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
)

func ReadOrder(ctx context.Context, db *sql.DB, orderID string) (OrderRecord, error) {
	return readOrder(ctx, db, "o.id=$1", strings.TrimSpace(orderID))
}

func ReadOrderPaymentAmounts(ctx context.Context, db *sql.DB, orderID, paymentIntentID string) (customerPayableMinor, cashAmountMinor int64, err error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(paymentIntentID) == "" {
		return 0, 0, ErrPaymentStateConflict
	}
	err = db.QueryRowContext(ctx, `SELECT total_amount_minor,payment_cash_amount_minor FROM dsh.commerce_orders WHERE id=$1 AND payment_intent_id=$2`, strings.TrimSpace(orderID), strings.TrimSpace(paymentIntentID)).Scan(&customerPayableMinor, &cashAmountMinor)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, ErrPaymentStateConflict
	}
	return customerPayableMinor, cashAmountMinor, err
}

func ReadOrderForClient(ctx context.Context, db *sql.DB, orderID, clientActorID string) (OrderRecord, error) {
	return readOrder(ctx, db, "o.id=$1 AND o.client_actor_id=$2", strings.TrimSpace(orderID), strings.TrimSpace(clientActorID))
}

func ListOrdersForClient(ctx context.Context, db *sql.DB, clientActorID, state string, limit int) ([]OrderRecord, error) {
	return listOrders(ctx, db, "o.client_actor_id=$1", []any{strings.TrimSpace(clientActorID)}, state, limit)
}

func ListOrdersForClientByCart(ctx context.Context, db *sql.DB, clientActorID, cartID string) ([]OrderRecord, error) {
	clientActorID, cartID = strings.TrimSpace(clientActorID), strings.TrimSpace(cartID)
	if clientActorID == "" || cartID == "" {
		return nil, ErrOrderNotFound
	}
	return listOrders(ctx, db, "o.client_actor_id=$1 AND o.cart_id=$2", []any{clientActorID, cartID}, "", 1)
}

func ListOrdersForStore(ctx context.Context, db *sql.DB, storeID, state string, limit int) ([]OrderRecord, error) {
	return listOrders(ctx, db, "o.store_id=$1", []any{strings.TrimSpace(storeID)}, state, limit)
}

// PartnerOrdersPage is one bounded, server-authorized page of Partner orders
// with a keyset continuation cursor.
type PartnerOrdersPage struct {
	Orders     []OrderRecord
	NextCursor string
}

// PartnerOrderAttentionCounts are unfiltered counts over the authorized Store
// scope so badges stay stable while the partner filters the visible list.
type PartnerOrderAttentionCounts struct {
	NewOrders        int64
	AwaitingDispatch int64
	DeliveryRecovery int64
}

type partnerOrdersCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
	State     string    `json:"state"`
	Query     string    `json:"query"`
}

func encodePartnerOrdersCursor(cursor partnerOrdersCursor) string {
	raw, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodePartnerOrdersCursor(raw, state, query string) (partnerOrdersCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return partnerOrdersCursor{}, ErrPartnerOrdersInvalidCursor
	}
	var cursor partnerOrdersCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return partnerOrdersCursor{}, ErrPartnerOrdersInvalidCursor
	}
	if cursor.State != state || cursor.Query != query || cursor.ID == "" || cursor.CreatedAt.IsZero() {
		return partnerOrdersCursor{}, ErrPartnerOrdersInvalidCursor
	}
	return cursor, nil
}

// ListPartnerOrdersAuthorizedStoreIDs resolves the server-owned authorized
// scope for Partner order reads: owned Stores plus active Store grants carrying
// the orders permission. Client-provided scope is never trusted.
func ListPartnerOrdersAuthorizedStoreIDs(ctx context.Context, db *sql.DB, actorID string) ([]string, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return nil, ErrPartnerOrdersScopeInvalid
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM dsh.stores WHERE partner_actor_id=$1
		UNION SELECT store_id FROM dsh.store_access_grants WHERE delegate_actor_id=$1 AND state='active' AND 'orders'=ANY(permissions)`, actorID)
	if err != nil {
		return nil, fmt.Errorf("resolve partner orders scope: %w", err)
	}
	defer rows.Close()
	storeIDs := make([]string, 0, 4)
	for rows.Next() {
		var storeID string
		if err := rows.Scan(&storeID); err != nil {
			return nil, err
		}
		storeIDs = append(storeIDs, storeID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return storeIDs, nil
}

// ListOrdersForPartnerStores returns one keyset page of orders across the given
// server-authorized Store scope, filtered by canonical states and a bounded
// search over order id and Store name.
func ListOrdersForPartnerStores(ctx context.Context, db *sql.DB, storeIDs []string, states []string, query string, limit int, cursor string) (PartnerOrdersPage, error) {
	if db == nil || limit < 1 || limit > 100 || len(storeIDs) == 0 || len(storeIDs) > 200 {
		return PartnerOrdersPage{}, ErrPartnerOrdersScopeInvalid
	}
	states, err := canonicalOrderStates(states)
	if err != nil {
		return PartnerOrdersPage{}, err
	}
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 128 {
		return PartnerOrdersPage{}, ErrPartnerOrdersInvalidQuery
	}
	statesKey := strings.Join(states, ",")
	args := []any{pq.Array(storeIDs)}
	where := "o.store_id = ANY($1)"
	if len(states) > 0 {
		args = append(args, pq.Array(states))
		where += " AND o.state = ANY($" + strconv.Itoa(len(args)) + ")"
	}
	if query != "" {
		args = append(args, "%"+escapeOperatorOperationSearch(query)+"%")
		where += " AND (o.id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.name ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!')"
	}
	if strings.TrimSpace(cursor) != "" {
		decoded, err := decodePartnerOrdersCursor(cursor, statesKey, query)
		if err != nil {
			return PartnerOrdersPage{}, err
		}
		args = append(args, decoded.CreatedAt, decoded.ID)
		where += " AND (o.created_at,o.id) < ($" + strconv.Itoa(len(args)-1) + ",$" + strconv.Itoa(len(args)) + ")"
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE "+where+" ORDER BY o.created_at DESC,o.id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return PartnerOrdersPage{}, err
	}
	defer rows.Close()
	items := make([]OrderRecord, 0, limit+1)
	for rows.Next() {
		order, scanErr := scanOrderWithStore(rows)
		if scanErr != nil {
			return PartnerOrdersPage{}, scanErr
		}
		items = append(items, order)
	}
	if err := rows.Err(); err != nil {
		return PartnerOrdersPage{}, err
	}
	rows.Close()
	page := PartnerOrdersPage{Orders: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Orders = items[:limit]
		page.NextCursor = encodePartnerOrdersCursor(partnerOrdersCursor{CreatedAt: last.CreatedAt, ID: last.ID, State: statesKey, Query: query})
	}
	var lineErr error
	for index := range page.Orders {
		page.Orders[index].Lines, lineErr = listOrderLines(ctx, db, page.Orders[index].ID)
		if lineErr != nil {
			return PartnerOrdersPage{}, lineErr
		}
		page.Orders[index].Adjustments, lineErr = listOrderAdjustments(ctx, db, page.Orders[index].ID)
		if lineErr != nil {
			return PartnerOrdersPage{}, lineErr
		}
	}
	return page, nil
}

// canonicalOrderStates validates a bounded order-state filter: every entry must
// be a canonical state and at most seven states may be combined.
func canonicalOrderStates(states []string) ([]string, error) {
	if len(states) > 7 {
		return nil, ErrPartnerOrdersInvalidState
	}
	canonical := make([]string, 0, len(states))
	seen := map[string]struct{}{}
	for _, state := range states {
		state = strings.TrimSpace(state)
		if state == "" {
			continue
		}
		if !validOrderState(state) {
			return nil, ErrPartnerOrdersInvalidState
		}
		if _, duplicate := seen[state]; duplicate {
			continue
		}
		seen[state] = struct{}{}
		canonical = append(canonical, state)
	}
	sort.Strings(canonical)
	return canonical, nil
}

// CountPartnerOrderAttention computes unfiltered attention counts over the
// authorized Store scope.
func CountPartnerOrderAttention(ctx context.Context, db *sql.DB, storeIDs []string) (PartnerOrderAttentionCounts, error) {
	if db == nil || len(storeIDs) == 0 || len(storeIDs) > 200 {
		return PartnerOrderAttentionCounts{}, ErrPartnerOrdersScopeInvalid
	}
	var counts PartnerOrderAttentionCounts
	err := db.QueryRowContext(ctx, `SELECT
			count(*) FILTER (WHERE o.state='CREATED'),
			count(*) FILTER (WHERE o.state='READY_FOR_DISPATCH'),
			count(*) FILTER (WHERE o.state='DELIVERY_FAILED')
		FROM dsh.commerce_orders o WHERE o.store_id = ANY($1)`, pq.Array(storeIDs)).Scan(&counts.NewOrders, &counts.AwaitingDispatch, &counts.DeliveryRecovery)
	if err != nil {
		return PartnerOrderAttentionCounts{}, fmt.Errorf("count partner order attention: %w", err)
	}
	return counts, nil
}

func validOrderState(state string) bool {
	switch state {
	case "CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "PICKED_UP", "CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERED", "DELIVERY_FAILED", "REJECTED", "CANCELLED":
		return true
	}
	return false
}

var (
	ErrOperatorOperationInvalidCursor = errors.New("operator operation cursor is invalid")
	ErrOperatorOperationInvalidLimit  = errors.New("operator operation limit is invalid")
	ErrOperatorOperationInvalidQuery  = errors.New("operator operation search query is invalid")
	ErrOperatorOperationInvalidSort   = errors.New("operator operation sort is invalid")
)

type operatorOperationsCursor struct {
	UpdatedAt      time.Time `json:"updatedAt"`
	ID             string    `json:"id"`
	State          string    `json:"state"`
	ActionableOnly bool      `json:"actionableOnly"`
	Query          string    `json:"query"`
	Sort           string    `json:"sort"`
	StoreID        string    `json:"storeId,omitempty"`
}

func ListOrdersForOperator(ctx context.Context, db *sql.DB, state, query, sort string, actionableOnly bool, limit int, cursor string) (OperatorOperationsResult, error) {
	return listOrdersForOperatorScope(ctx, db, state, query, sort, actionableOnly, limit, cursor, "")
}

func ListOrdersForOperatorStore(ctx context.Context, db *sql.DB, state, query, sort string, actionableOnly bool, limit int, cursor, storeID string) (OperatorOperationsResult, error) {
	storeID = strings.TrimSpace(storeID)
	if storeID == "" || len(storeID) > 128 {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidQuery
	}
	return listOrdersForOperatorScope(ctx, db, state, query, sort, actionableOnly, limit, cursor, storeID)
}

func listOrdersForOperatorScope(ctx context.Context, db *sql.DB, state, query, sort string, actionableOnly bool, limit int, cursor, storeID string) (OperatorOperationsResult, error) {
	if db == nil || limit < 1 || limit > 100 {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidLimit
	}
	state = strings.TrimSpace(state)
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 128 {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidQuery
	}
	sort = strings.TrimSpace(sort)
	if sort == "" {
		sort = "updated_desc"
	}
	if sort != "updated_desc" && sort != "updated_asc" {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidSort
	}
	ascending := sort == "updated_asc"
	args := []any{}
	where := "TRUE"
	if storeID != "" {
		args = append(args, storeID)
		where += " AND o.store_id=$" + strconv.Itoa(len(args))
	}
	if state != "" {
		args = append(args, state)
		where += " AND o.state=$" + strconv.Itoa(len(args))
	}
	// The operations attention queue includes stalled early fulfillment states, even
	// when no automatic state transition is safe. Read-only review must not depend
	// on an available dispatch action; terminal and customer-pickup states stay out.
	// A configured, stage-effective SLA overrides approximate early-stage attention.
	// Missing canonical stage events always require review; unconfigured stages
	// retain a clearly non-contractual operational attention fallback.
	const actionable = "(o.state='READY_FOR_DISPATCH' OR (o.state='CAPTAIN_ASSIGNED' AND a.state='assigned') OR (o.state='DELIVERY_FAILED' AND a.state='delivery_failed') OR (o.state IN ('CREATED','PARTNER_ACCEPTED','PREPARING') AND (stage.stage_started_at IS NULL OR (sla.target_minutes IS NOT NULL AND stage.stage_started_at <= statement_timestamp() - make_interval(mins => sla.target_minutes - sla.warning_minutes)) OR (sla.target_minutes IS NULL AND stage.stage_started_at <= statement_timestamp() - make_interval(mins => CASE WHEN o.state='PREPARING' THEN COALESCE(soa.preparation_minutes,30) ELSE 30 END)))) OR (o.state IN ('IN_CUSTODY','READY_FOR_PICKUP') AND sla.target_minutes IS NOT NULL AND stage.stage_started_at IS NOT NULL AND stage.stage_started_at <= statement_timestamp() - make_interval(mins => sla.target_minutes - sla.warning_minutes)))"
	if actionableOnly {
		where += " AND " + actionable
	}
	if query != "" {
		args = append(args, "%"+escapeOperatorOperationSearch(query)+"%")
		where += " AND (o.id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.name ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!')"
	}
	pageWhere := "TRUE"
	if strings.TrimSpace(cursor) != "" {
		decoded, err := decodeOperatorOperationsCursor(cursor, state, actionableOnly, query, sort, storeID)
		if err != nil {
			return OperatorOperationsResult{}, err
		}
		args = append(args, decoded.UpdatedAt, decoded.ID)
		operator := "<"
		if ascending {
			operator = ">"
		}
		pageWhere += " AND (updated_at,id)" + operator + "($" + strconv.Itoa(len(args)-1) + ",$" + strconv.Itoa(len(args)) + ")"
	}
	args = append(args, limit+1)
	order := "DESC"
	if ascending {
		order = "ASC"
	}
	// The filtered registry, totals and bounded page share a single statement snapshot.
	// Cursor predicates apply only to the page, never to the result-set summary.
	rows, err := db.QueryContext(ctx, `WITH filtered AS MATERIALIZED (
		SELECT o.id,s.name,o.state,o.updated_at,o.total_amount_minor AS order_value_minor,
		a.id AS assignment_id,a.order_id,a.captain_actor_id,a.state AS assignment_state,a.version,COALESCE(h.state,'') AS handoff_state,
        stage.stage_started_at, CASE WHEN o.state='PREPARING' THEN soa.preparation_minutes ELSE NULL END AS preparation_minutes,
        sla.target_minutes AS sla_target_minutes,sla.warning_minutes AS sla_warning_minutes,sla.policy_version AS sla_policy_version,
		`+actionable+` AS actionable
		FROM dsh.commerce_orders o
		JOIN dsh.stores s ON s.id=o.store_id
		LEFT JOIN LATERAL (
			SELECT id,order_id,captain_actor_id,state,version
			FROM dsh.captain_assignments
			WHERE order_id=o.id AND state IN ('assigned','in_custody','delivered','delivery_failed')
			ORDER BY created_at DESC LIMIT 1
		) a ON TRUE
		LEFT JOIN dsh.captain_handoffs h ON h.assignment_id=a.id
        LEFT JOIN dsh.store_operational_availability soa ON soa.store_id=o.store_id
        LEFT JOIN LATERAL (
        SELECT max(e.entered_at) FROM (
                SELECT a.created_at AS entered_at
                  FROM dsh.commerce_order_audit a
                 WHERE a.order_id=o.id AND a.to_state=o.state
                   AND a.event_type IN (
                      'order_created','order_partner_accepted','order_preparing',
                      'order_ready_for_dispatch','order_ready_for_pickup',
                      'order_picked_up','order_rejected','order_cancelled'
                   )
                UNION ALL
                SELECT c.created_at AS entered_at
                  FROM dsh.captain_audit c WHERE c.order_id=o.id
                   AND (
                      (o.state='CAPTAIN_ASSIGNED' AND c.event_type='dispatch_offer_accepted')
                      OR (o.state='IN_CUSTODY' AND c.event_type IN ('captain_pickup_completed','delivery_recovered'))
                      OR (o.state='DELIVERED' AND c.event_type='delivery_completed')
                      OR (o.state='DELIVERY_FAILED' AND c.event_type='delivery_failed')
                   )
            ) e
        ) AS stage(stage_started_at) ON TRUE
        LEFT JOIN LATERAL (
            SELECT p.target_minutes,p.warning_minutes,p.policy_version
            FROM dsh.operator_stage_sla_policies p
            WHERE p.fulfillment_mode=o.fulfillment_mode AND p.stage=o.state
              AND stage.stage_started_at IS NOT NULL AND p.effective_at<=stage.stage_started_at
            ORDER BY p.effective_at DESC,p.policy_version DESC LIMIT 1
        ) sla ON TRUE
		WHERE `+where+`
	), summary AS (
		SELECT count(*) AS total_count,
		count(*) FILTER (WHERE actionable) AS actionable_count,
		count(*) FILTER (WHERE state='READY_FOR_DISPATCH') AS awaiting_dispatch_count,
		count(*) FILTER (WHERE state NOT IN ('READY_FOR_DISPATCH','DELIVERY_FAILED','DELIVERED','REJECTED','CANCELLED')) AS active_count,
		count(*) FILTER (WHERE state='DELIVERED') AS delivered_count,
		count(*) FILTER (WHERE assignment_state='in_custody') AS in_custody_order_count,
		COALESCE(sum(order_value_minor) FILTER (WHERE assignment_state='in_custody'),0)::bigint AS in_custody_order_value_minor,
		statement_timestamp() AS measured_at FROM filtered
	), page AS (
        SELECT * FROM filtered WHERE `+pageWhere+" ORDER BY updated_at "+order+",id "+order+" LIMIT $"+strconv.Itoa(len(args))+`
	)
	SELECT summary.*,page.id,page.name,page.state,page.updated_at,page.assignment_id,page.order_id,page.captain_actor_id,page.assignment_state,page.version,page.handoff_state,page.stage_started_at,page.preparation_minutes,page.sla_target_minutes,page.sla_warning_minutes,page.sla_policy_version
	FROM summary LEFT JOIN page ON TRUE ORDER BY page.updated_at `+order+",page.id "+order, args...)
	if err != nil {
		return OperatorOperationsResult{}, err
	}
	defer rows.Close()
	operations := make([]OperatorOperationListRecord, 0, limit+1)
	var summary OperatorOperationsSummary
	for rows.Next() {
		var item OperatorOperationListRecord
		var id, storeName, state sql.NullString
		var updatedAt sql.NullTime
		var assignmentID, assignmentOrderID, captainActorID, assignmentState, handoffState sql.NullString
		var assignmentVersion sql.NullInt64
		var stageStartedAt sql.NullTime
		var preparationMinutes sql.NullInt64
		var slaTarget, slaWarning, slaVersion sql.NullInt64
		if err := rows.Scan(&summary.TotalCount, &summary.ActionableCount, &summary.AwaitingDispatchCount, &summary.ActiveCount, &summary.DeliveredCount, &summary.InCustodyOrderCount, &summary.InCustodyOrderValueMinor, &summary.MeasuredAt,
			&id, &storeName, &state, &updatedAt,
			&assignmentID, &assignmentOrderID, &captainActorID, &assignmentState, &assignmentVersion, &handoffState, &stageStartedAt, &preparationMinutes, &slaTarget, &slaWarning, &slaVersion); err != nil {
			return OperatorOperationsResult{}, err
		}
		if !id.Valid {
			continue // The summary still exists for empty results or an exhausted cursor.
		}
		item.OrderID, item.StoreName, item.State, item.UpdatedAt = id.String, storeName.String, state.String, updatedAt.Time
		if stageStartedAt.Valid {
			timeValue := stageStartedAt.Time
			item.StageStartedAt = &timeValue
		}
		if preparationMinutes.Valid {
			v := int(preparationMinutes.Int64)
			item.PreparationMinutes = &v
		}
		item.StageSLA = EvaluateOperatorStageSLA(summary.MeasuredAt, item.State, item.StageStartedAt, int(slaTarget.Int64), int(slaWarning.Int64), int(slaVersion.Int64))
		if assignmentID.Valid {
			item.Assignment = &OperatorAssignmentListRecord{ID: assignmentID.String, OrderID: assignmentOrderID.String, CaptainActorID: captainActorID.String, State: assignmentState.String, Version: int(assignmentVersion.Int64), HandoffState: handoffState.String}
		}
		operations = append(operations, item)
	}
	if err := rows.Err(); err != nil {
		return OperatorOperationsResult{}, err
	}
	if err := rows.Close(); err != nil {
		return OperatorOperationsResult{}, err
	}

	result := OperatorOperationsResult{Operations: operations, Summary: summary}
	if len(operations) > limit {
		last := operations[limit-1]
		result.Operations = operations[:limit]
		result.NextCursor = encodeOperatorOperationsCursor(operatorOperationsCursor{UpdatedAt: last.UpdatedAt, ID: last.OrderID, State: state, ActionableOnly: actionableOnly, Query: query, Sort: sort, StoreID: storeID})
	}
	return result, nil
}

func ReadOperatorOperation(ctx context.Context, db *sql.DB, orderID string) (OperatorOperationRecord, error) {
	order, err := ReadOrder(ctx, db, orderID)
	if err != nil {
		return OperatorOperationRecord{}, err
	}
	operation := OperatorOperationRecord{Order: order, StoreName: order.StoreName}
	assignment, assignmentErr := ReadCaptainAssignmentForOrder(ctx, db, order.ID)
	if assignmentErr == nil {
		operation.Assignment = &assignment
	} else if !errors.Is(assignmentErr, ErrCaptainAssignmentNotFound) {
		return OperatorOperationRecord{}, assignmentErr
	}
	// Order state alone is not completion proof. Use terminal state AND its
	// canonical completion event; a Captain pickup is not customer delivery.
	err = db.QueryRowContext(ctx, `
WITH completed AS (
	SELECT o.id, (SELECT min(a.created_at) FROM dsh.captain_audit a
		WHERE a.order_id=o.id AND a.event_type='delivery_completed') AS completed_at
	FROM dsh.commerce_orders o
	WHERE o.client_actor_id=$1 AND o.state='DELIVERED' AND o.fulfillment_mode<>'CUSTOMER_PICKUP'
	UNION ALL
	SELECT o.id, (SELECT min(a.created_at) FROM dsh.commerce_order_audit a
		WHERE a.order_id=o.id AND a.event_type='order_picked_up') AS completed_at
	FROM dsh.commerce_orders o
	WHERE o.client_actor_id=$1 AND o.state='PICKED_UP' AND o.fulfillment_mode='CUSTOMER_PICKUP'
), ranked AS (
	SELECT id, row_number() OVER (ORDER BY completed_at,id) AS ordinal
	FROM completed WHERE completed_at IS NOT NULL
)
SELECT count(*)::integer, COALESCE(max(ordinal) FILTER (WHERE id=$2),0)::integer FROM ranked
`, order.ClientActorID, order.ID).Scan(&operation.CustomerSuccessfulOrdersCount, &operation.SuccessfulOrderOrdinal)
	if err != nil {
		return OperatorOperationRecord{}, err
	}
	// The operator timeline uses persisted facts, never a reconstructed state
	// sequence. Bound the read and signal explicitly when older events exist.
	rows, err := db.QueryContext(ctx, `
SELECT id::text, source, event_type, to_state, acting_actor_id, decision_reason, created_at FROM (
	SELECT 'order'::text AS source, event_type, to_state, acting_actor_id, COALESCE(decision_reason,'') AS decision_reason, created_at, id
	FROM dsh.commerce_order_audit WHERE order_id=$1
	UNION ALL
	SELECT 'captain'::text AS source, event_type, to_state, acting_actor_id, ''::text AS decision_reason, created_at, id
	FROM dsh.captain_audit WHERE order_id=$1
) history ORDER BY created_at DESC, source, id DESC LIMIT 101`, order.ID)
	if err != nil {
		return OperatorOperationRecord{}, err
	}
	defer rows.Close()
	operation.History = make([]OperatorOperationEventRecord, 0)
	for rows.Next() {
		var event OperatorOperationEventRecord
		if err := rows.Scan(&event.ID, &event.Source, &event.EventType, &event.State, &event.ActorID, &event.Reason, &event.At); err != nil {
			return OperatorOperationRecord{}, err
		}
		if len(operation.History) == 100 {
			operation.HistoryHasMore = true
			break
		}
		operation.History = append(operation.History, event)
	}
	if err := rows.Err(); err != nil {
		return OperatorOperationRecord{}, err
	}
	return operation, nil
}

func encodeOperatorOperationsCursor(cursor operatorOperationsCursor) string {
	value, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(value)
}

func decodeOperatorOperationsCursor(raw, state string, actionableOnly bool, query, sort, storeID string) (operatorOperationsCursor, error) {
	value, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return operatorOperationsCursor{}, ErrOperatorOperationInvalidCursor
	}
	var cursor operatorOperationsCursor
	if err := json.Unmarshal(value, &cursor); err != nil || cursor.ID == "" || cursor.UpdatedAt.IsZero() || cursor.State != strings.TrimSpace(state) || cursor.ActionableOnly != actionableOnly || cursor.Query != strings.TrimSpace(query) || cursor.Sort != strings.TrimSpace(sort) || cursor.StoreID != storeID {
		return operatorOperationsCursor{}, ErrOperatorOperationInvalidCursor
	}
	return cursor, nil
}

func escapeOperatorOperationSearch(value string) string {
	value = strings.ReplaceAll(value, "!", "!!")
	value = strings.ReplaceAll(value, "%", "!%")
	return strings.ReplaceAll(value, "_", "!_")
}

const orderSelectColumns = `o.id,o.client_actor_id,o.store_id,o.cart_id,o.fulfillment_mode,COALESCE(o.address_id,''),COALESCE(o.address_version,0),COALESCE(o.address_text,''),COALESCE(o.address_latitude,0),COALESCE(o.address_longitude,0),o.service_city_id,COALESCE(o.serviceability_policy_version,''),COALESCE(o.serviceability_status,''),o.serviceability_store_version,COALESCE(o.serviceability_address_version,0),COALESCE((SELECT a.orderability_state FROM dsh.commerce_order_store_orderability_snapshots a WHERE a.order_id=o.id),''),COALESCE((SELECT a.availability_version FROM dsh.commerce_order_store_orderability_snapshots a WHERE a.order_id=o.id),0),(SELECT a.evaluated_at FROM dsh.commerce_order_store_orderability_snapshots a WHERE a.order_id=o.id),o.state,o.subtotal_amount_minor,o.discount_minor,o.promotion_id,o.promotion_code,COALESCE(o.promotion_version,0),COALESCE(o.promotion_funding_source,''),COALESCE(o.promotion_funding_share_partner_percent,0),o.total_amount_minor,o.payment_cash_amount_minor,o.currency,o.payment_intent_id,o.payment_method,o.payment_state,o.version,o.created_at,o.updated_at,COALESCE((SELECT h.state FROM dsh.commerce_order_store_cash_handoffs h WHERE h.order_id=o.id),''),o.recipient_mode,o.recipient_name,o.recipient_phone_e164,o.recipient_instructions,o.cancellation_mode,o.cancellation_policy_version,COALESCE(o.customer_note,'')`
const orderSelectColumnsWithStore = orderSelectColumns + `,s.name,CASE WHEN o.fulfillment_mode='CUSTOMER_PICKUP' THEN s.delivery_origin_latitude END,CASE WHEN o.fulfillment_mode='CUSTOMER_PICKUP' THEN s.delivery_origin_longitude END`

func scanOrder(row rowScanner) (OrderRecord, error) {
	return scanOrderColumns(row, false)
}

func scanOrderWithStore(row rowScanner) (OrderRecord, error) {
	return scanOrderColumns(row, true)
}

func scanOrderColumns(row rowScanner, includeStore bool) (OrderRecord, error) {
	var order OrderRecord
	var paymentIntentID, promotionID, promotionCode sql.NullString
	var recipientName, recipientPhone, recipientInstructions sql.NullString
	var orderabilityState sql.NullString
	var orderabilityVersion sql.NullInt64
	var orderabilityEvaluatedAt sql.NullTime
	var pickupLatitude, pickupLongitude sql.NullFloat64
	destinations := []any{
		&order.ID, &order.ClientActorID, &order.StoreID, &order.CartID, &order.FulfillmentMode, &order.AddressID, &order.AddressVersion, &order.AddressText,
		&order.AddressLatitude, &order.AddressLongitude, &order.ServiceCityID, &order.ServiceabilityPolicyVersion, &order.ServiceabilityStatus,
		&order.ServiceabilityStoreVersion, &order.ServiceabilityAddressVersion, &orderabilityState, &orderabilityVersion, &orderabilityEvaluatedAt, &order.State, &order.SubtotalAmountMinor, &order.DiscountMinor, &promotionID, &promotionCode, &order.PromotionVersion, &order.PromotionFundingSource, &order.PromotionFundingSharePercent, &order.TotalAmountMinor, &order.PaymentCashAmountMinor, &order.Currency,
		&paymentIntentID, &order.PaymentMethod, &order.PaymentState, &order.Version, &order.CreatedAt, &order.UpdatedAt, &order.StoreCashHandoffState,
		&order.Recipient.Mode, &recipientName, &recipientPhone, &recipientInstructions, &order.CancellationMode, &order.CancellationPolicyVersion, &order.CustomerNote,
	}
	if includeStore {
		destinations = append(destinations, &order.StoreName, &pickupLatitude, &pickupLongitude)
	}
	if err := row.Scan(destinations...); err != nil {
		return OrderRecord{}, err
	}
	if promotionID.Valid {
		order.PromotionID = promotionID.String
	}
	if promotionCode.Valid {
		order.PromotionCode = promotionCode.String
	}
	if paymentIntentID.Valid {
		value := paymentIntentID.String
		order.PaymentIntentID = &value
	}
	if recipientName.Valid {
		value := recipientName.String
		order.Recipient.Name = &value
	}
	if recipientPhone.Valid {
		value := recipientPhone.String
		order.Recipient.PhoneE164 = &value
	}
	if recipientInstructions.Valid {
		value := recipientInstructions.String
		order.Recipient.Instructions = &value
	}
	if orderabilityState.Valid {
		order.StoreOrderabilityState = orderabilityState.String
	}
	if orderabilityVersion.Valid {
		order.StoreOrderabilityVersion = int(orderabilityVersion.Int64)
	}
	if orderabilityEvaluatedAt.Valid {
		value := orderabilityEvaluatedAt.Time
		order.StoreOrderabilityEvaluatedAt = &value
	}
	if includeStore {
		if pickupLatitude.Valid != pickupLongitude.Valid {
			return OrderRecord{}, errors.New("pickup location coordinates are incomplete")
		}
		if pickupLatitude.Valid {
			order.PickupLocation = &OrderPickupLocationRecord{Latitude: pickupLatitude.Float64, Longitude: pickupLongitude.Float64}
		}
	}
	return order, nil
}

func readOrder(ctx context.Context, source rowQueryer, where string, args ...any) (OrderRecord, error) {
	order, err := scanOrderWithStore(source.QueryRowContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE "+where, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, err
	}
	order.Lines, err = listOrderLines(ctx, source, order.ID)
	if err != nil {
		return OrderRecord{}, err
	}
	order.Adjustments, err = listOrderAdjustments(ctx, source, order.ID)
	if err != nil {
		return OrderRecord{}, err
	}
	return order, nil
}

func listOrders(ctx context.Context, db *sql.DB, where string, args []any, state string, limit int) ([]OrderRecord, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("order limit is invalid")
	}
	if strings.TrimSpace(state) != "" {
		args = append(args, strings.TrimSpace(state))
		where += " AND o.state=$" + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE "+where+" ORDER BY o.created_at DESC,o.id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	items := make([]OrderRecord, 0)
	for rows.Next() {
		order, scanErr := scanOrderWithStore(rows)
		if scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		items = append(items, order)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Lines, err = listOrderLines(ctx, db, items[index].ID)
		if err != nil {
			return nil, err
		}
		items[index].Adjustments, err = listOrderAdjustments(ctx, db, items[index].ID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func listOrderLines(ctx context.Context, source queryer, orderID string) ([]OrderLineRecord, error) {
	rows, err := source.QueryContext(ctx, `SELECT id,order_id,store_offer_id,variant_id,product_id,product_name,variant_title,measurement_kind,base_unit,pricing_basis,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_unit_base_units,requested_quantity_base_units,final_quantity_base_units,unit_price_minor,line_amount_minor,currency,selected_modifier_option_ids,modifier_amount_minor,created_at FROM dsh.commerce_order_lines WHERE order_id=$1 ORDER BY created_at,id`, orderID)
	if err != nil {
		return nil, err
	}
	items := make([]OrderLineRecord, 0)
	for rows.Next() {
		var item OrderLineRecord
		var finalQuantity sql.NullInt64
		if err := rows.Scan(&item.ID, &item.OrderID, &item.StoreOfferID, &item.VariantID, &item.ProductID, &item.ProductName, &item.VariantTitle, &item.MeasurementKind, &item.BaseUnit, &item.PricingBasis, &item.QuantityPolicy, &item.QuantityMinBaseUnits, &item.QuantityMaxBaseUnits, &item.QuantityStepBaseUnits, &item.PricingUnitBaseUnits, &item.RequestedQuantityBaseUnits, &finalQuantity, &item.UnitPriceMinor, &item.LineAmountMinor, &item.Currency, pq.Array(&item.SelectedModifierOptionIDs), &item.ModifierAmountMinor, &item.CreatedAt); err != nil {
			return nil, err
		}
		if finalQuantity.Valid {
			value := finalQuantity.Int64
			item.FinalQuantityBaseUnits = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].ModifierSnapshots, err = listOrderLineModifierSnapshots(ctx, source, items[index].ID)
		if err != nil {
			return nil, err
		}
		items[index].AttributeSnapshots, err = listOrderLineAttributeSnapshots(ctx, source, items[index].ID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func listOrderLineModifierSnapshots(ctx context.Context, source queryer, orderLineID string) ([]OrderLineModifierSnapshotRecord, error) {
	rows, err := source.QueryContext(ctx, "SELECT option_id,option_name_ar,price_delta_minor FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id=$1 ORDER BY created_at,option_id", orderLineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]OrderLineModifierSnapshotRecord, 0)
	for rows.Next() {
		var item OrderLineModifierSnapshotRecord
		if err := rows.Scan(&item.OptionID, &item.OptionNameAr, &item.PriceDeltaMinor); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listOrderLineAttributeSnapshots(ctx context.Context, source queryer, orderLineID string) ([]OrderLineAttributeSnapshotRecord, error) {
	rows, err := source.QueryContext(ctx, "SELECT attribute_id,attribute_code,value_kind,text_value,integer_value,decimal_value,boolean_value,enum_value,date_value,measurement_unit FROM dsh.commerce_order_line_attribute_snapshots WHERE order_line_id=$1 ORDER BY created_at,attribute_id", orderLineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]OrderLineAttributeSnapshotRecord, 0)
	for rows.Next() {
		var item OrderLineAttributeSnapshotRecord
		if err := rows.Scan(&item.AttributeID, &item.Code, &item.ValueKind, &item.TextValue, &item.IntegerValue, &item.DecimalValue, &item.BooleanValue, &item.EnumValue, &item.DateValue, &item.MeasurementUnit); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
