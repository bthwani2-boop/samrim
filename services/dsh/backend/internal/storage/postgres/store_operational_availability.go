package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

const StoreScheduleTimezone = "Asia/Aden"

const (
	StoreOrderabilityOpenForOrders       = "OPEN_FOR_ORDERS"
	StoreOrderabilityClosedBySchedule    = "CLOSED_BY_SCHEDULE"
	StoreOrderabilityPaused              = "PAUSED"
	StoreOrderabilityOperationallyClosed = "OPERATIONALLY_UNAVAILABLE"
)

type StoreScheduleWindow struct {
	DayOfWeek      int `json:"dayOfWeek"`
	OpensAtMinute  int `json:"opensAtMinute"`
	ClosesAtMinute int `json:"closesAtMinute"`
}

type StoreOperationalAvailability struct {
	StoreID                     string                `json:"storeId"`
	ScheduleMode                string                `json:"scheduleMode"`
	ScheduleTimezone            string                `json:"scheduleTimezone"`
	WeeklySchedule              []StoreScheduleWindow `json:"weeklySchedule"`
	Paused                      bool                  `json:"paused"`
	PauseReason                 *string               `json:"pauseReason,omitempty"`
	PauseUntil                  *time.Time            `json:"pauseUntil,omitempty"`
	PreparationMinutes          *int                  `json:"preparationMinutes,omitempty"`
	UnavailableFulfillmentModes []string              `json:"unavailableFulfillmentModes"`
	Version                     int                   `json:"version"`
	UpdatedByActorID            string                `json:"updatedByActorId"`
	UpdatedAt                   time.Time             `json:"updatedAt"`
}

type StoreOrderability struct {
	StoreID            string    `json:"storeId"`
	FulfillmentMode    string    `json:"fulfillmentMode"`
	State              string    `json:"state"`
	Reason             *string   `json:"reason,omitempty"`
	PreparationMinutes *int      `json:"preparationMinutes,omitempty"`
	Version            int       `json:"version"`
	EvaluatedAt        time.Time `json:"evaluatedAt"`
}

type UpdateStoreOperationalAvailabilityInput struct {
	StoreID                     string
	ScheduleMode                string
	WeeklySchedule              []StoreScheduleWindow
	Paused                      bool
	PauseReason                 *string
	PauseUntil                  *time.Time
	PreparationMinutes          *int
	UnavailableFulfillmentModes []string
	ExpectedVersion             int
	ActingActorID               string
	AuthoritySource             string
	IdempotencyKey              string
	CorrelationID               string
}

var (
	ErrStoreOperationalAvailabilityNotFound = errors.New("Store operational availability was not found")
	ErrStoreOperationalAvailabilityInvalid  = errors.New("Store operational availability is invalid")
	ErrStoreOperationalAvailabilityVersion  = errors.New("Store operational availability version is stale")
	ErrStoreOperationalAvailabilityIdem     = errors.New("Store operational availability idempotency key conflicts with previous facts")
)

func HashStoreOperationalAvailabilityMutation(input UpdateStoreOperationalAvailabilityInput) string {
	schedule, _ := json.Marshal(canonicalSchedule(input.WeeklySchedule))
	pauseReason := ""
	if input.PauseReason != nil {
		pauseReason = strings.TrimSpace(*input.PauseReason)
	}
	pauseUntil := ""
	if input.PauseUntil != nil {
		pauseUntil = input.PauseUntil.UTC().Format(time.RFC3339Nano)
	}
	preparation := ""
	if input.PreparationMinutes != nil {
		preparation = fmt.Sprint(*input.PreparationMinutes)
	}
	return hashLocationFacts(
		"store-operational-availability",
		strings.TrimSpace(input.StoreID), strings.TrimSpace(input.ScheduleMode), string(schedule), fmt.Sprint(input.Paused),
		pauseReason, pauseUntil, preparation, strings.Join(canonicalModes(input.UnavailableFulfillmentModes), ","),
		fmt.Sprint(input.ExpectedVersion), strings.TrimSpace(input.ActingActorID), strings.TrimSpace(input.AuthoritySource),
	)
}

func ReadStoreOperationalAvailability(ctx context.Context, db *sql.DB, storeID string) (StoreOperationalAvailability, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" {
		return StoreOperationalAvailability{}, ErrStoreOperationalAvailabilityInvalid
	}
	if err := ensureStoreOperationalAvailability(ctx, db, storeID); err != nil {
		return StoreOperationalAvailability{}, err
	}
	return readStoreOperationalAvailabilityRow(ctx, db.QueryRowContext(ctx, `SELECT store_id,schedule_mode,schedule_timezone,weekly_schedule,
		paused,pause_reason,pause_until,preparation_minutes,unavailable_fulfillment_modes,version,updated_by_actor_id,updated_at
		FROM dsh.store_operational_availability WHERE store_id=$1`, storeID))
}

func EvaluateStoreOrderability(ctx context.Context, db *sql.DB, storeID, fulfillmentMode string, at time.Time) (StoreOrderability, error) {
	availability, err := ReadStoreOperationalAvailability(ctx, db, storeID)
	if err != nil {
		return StoreOrderability{}, err
	}
	fulfillmentMode = strings.TrimSpace(fulfillmentMode)
	if !validFulfillmentMode(fulfillmentMode) {
		return StoreOrderability{}, ErrStoreOperationalAvailabilityInvalid
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}
	result := StoreOrderability{StoreID: availability.StoreID, FulfillmentMode: fulfillmentMode, State: StoreOrderabilityOpenForOrders, PreparationMinutes: availability.PreparationMinutes, Version: availability.Version, EvaluatedAt: at.UTC()}
	if availability.Paused && (availability.PauseUntil == nil || availability.PauseUntil.After(at)) {
		result.State = StoreOrderabilityPaused
		result.Reason = availability.PauseReason
		return result, nil
	}
	if availability.ScheduleMode == "WEEKLY" && !scheduleContains(availability.WeeklySchedule, at) {
		result.State = StoreOrderabilityClosedBySchedule
		reason := "outside_store_operating_schedule"
		result.Reason = &reason
		return result, nil
	}
	for _, mode := range availability.UnavailableFulfillmentModes {
		if mode == fulfillmentMode {
			result.State = StoreOrderabilityOperationallyClosed
			reason := "fulfillment_mode_temporarily_unavailable"
			result.Reason = &reason
			return result, nil
		}
	}
	return result, nil
}

func UpdateStoreOperationalAvailability(ctx context.Context, db *sql.DB, input UpdateStoreOperationalAvailabilityInput) (StoreOperationalAvailability, bool, error) {
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.ScheduleMode = strings.TrimSpace(input.ScheduleMode)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.AuthoritySource = strings.TrimSpace(input.AuthoritySource)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.WeeklySchedule = canonicalSchedule(input.WeeklySchedule)
	input.UnavailableFulfillmentModes = canonicalModes(input.UnavailableFulfillmentModes)
	if err := validateStoreOperationalAvailabilityInput(input); err != nil {
		return StoreOperationalAvailability{}, false, err
	}
	requestHash := HashStoreOperationalAvailabilityMutation(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("begin Store operational availability mutation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-operational-availability-idem:"+input.IdempotencyKey); err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("lock Store operational availability idempotency: %w", err)
	}
	var previousHash, previousStore, previousActor string
	var previousVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash,store_id,acting_actor_id,result_version
		FROM dsh.store_operational_availability_idempotency WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(&previousHash, &previousStore, &previousActor, &previousVersion)
	if err == nil {
		if previousHash != requestHash || previousStore != input.StoreID || previousActor != input.ActingActorID {
			return StoreOperationalAvailability{}, false, ErrStoreOperationalAvailabilityIdem
		}
		availability, readErr := readStoreOperationalAvailabilityRow(ctx, tx.QueryRowContext(ctx, `SELECT store_id,schedule_mode,schedule_timezone,weekly_schedule,
			paused,pause_reason,pause_until,preparation_minutes,unavailable_fulfillment_modes,version,updated_by_actor_id,updated_at
			FROM dsh.store_operational_availability WHERE store_id=$1`, input.StoreID))
		if readErr != nil {
			return StoreOperationalAvailability{}, false, readErr
		}
		if availability.Version != previousVersion {
			return StoreOperationalAvailability{}, false, ErrStoreOperationalAvailabilityIdem
		}
		if err := tx.Commit(); err != nil {
			return StoreOperationalAvailability{}, false, fmt.Errorf("commit Store availability replay: %w", err)
		}
		return availability, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreOperationalAvailability{}, false, fmt.Errorf("read Store availability idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability(store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,unavailable_fulfillment_modes,version,updated_by_actor_id)
		VALUES($1,'ALWAYS_OPEN',$2,'[]'::jsonb,false,ARRAY[]::text[],1,'system:lazy-initialize') ON CONFLICT(store_id) DO NOTHING`, input.StoreID, StoreScheduleTimezone); err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("ensure Store operational availability: %w", err)
	}
	current, err := readStoreOperationalAvailabilityRow(ctx, tx.QueryRowContext(ctx, `SELECT store_id,schedule_mode,schedule_timezone,weekly_schedule,
		paused,pause_reason,pause_until,preparation_minutes,unavailable_fulfillment_modes,version,updated_by_actor_id,updated_at
		FROM dsh.store_operational_availability WHERE store_id=$1 FOR UPDATE`, input.StoreID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreOperationalAvailability{}, false, ErrStoreOperationalAvailabilityNotFound
	}
	if err != nil {
		return StoreOperationalAvailability{}, false, err
	}
	if current.Version != input.ExpectedVersion {
		return StoreOperationalAvailability{}, false, ErrStoreOperationalAvailabilityVersion
	}
	scheduleJSON, _ := json.Marshal(input.WeeklySchedule)
	var pauseReason any
	if input.PauseReason != nil {
		value := strings.TrimSpace(*input.PauseReason)
		pauseReason = value
	}
	var pauseUntil any
	if input.PauseUntil != nil {
		pauseUntil = input.PauseUntil.UTC()
	}
	var preparation any
	if input.PreparationMinutes != nil {
		preparation = *input.PreparationMinutes
	}
	updated, err := readStoreOperationalAvailabilityRow(ctx, tx.QueryRowContext(ctx, `UPDATE dsh.store_operational_availability SET
		schedule_mode=$2,schedule_timezone=$3,weekly_schedule=$4::jsonb,paused=$5,pause_reason=$6,pause_until=$7,
		preparation_minutes=$8,unavailable_fulfillment_modes=$9,version=version+1,updated_by_actor_id=$10,updated_at=clock_timestamp()
		WHERE store_id=$1 AND version=$11
		RETURNING store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,pause_reason,pause_until,preparation_minutes,
		unavailable_fulfillment_modes,version,updated_by_actor_id,updated_at`, input.StoreID, input.ScheduleMode, StoreScheduleTimezone, string(scheduleJSON), input.Paused, pauseReason, pauseUntil, preparation, pq.Array(input.UnavailableFulfillmentModes), input.ActingActorID, input.ExpectedVersion))
	if err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("update Store operational availability: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability_idempotency
		(idempotency_key,request_hash,store_id,acting_actor_id,result_version) VALUES($1,$2,$3,$4,$5)`, input.IdempotencyKey, requestHash, input.StoreID, input.ActingActorID, updated.Version); err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("record Store availability idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability_audit
		(store_id,event_type,idempotency_key,correlation_id,acting_actor_id,authority_source,expected_version,result_version,request_hash)
		VALUES($1,'operational_availability_changed',$2,$3,$4,$5,$6,$7,$8)`, input.StoreID, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, input.AuthoritySource, input.ExpectedVersion, updated.Version, requestHash); err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("record Store availability audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return StoreOperationalAvailability{}, false, fmt.Errorf("commit Store operational availability mutation: %w", err)
	}
	return updated, false, nil
}

func ensureStoreOperationalAvailability(ctx context.Context, db *sql.DB, storeID string) error {
	result, err := db.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability(store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,unavailable_fulfillment_modes,version,updated_by_actor_id)
		SELECT id,'ALWAYS_OPEN',$2,'[]'::jsonb,false,ARRAY[]::text[],1,'system:lazy-initialize' FROM dsh.stores WHERE id=$1
		ON CONFLICT(store_id) DO NOTHING`, storeID, StoreScheduleTimezone)
	if err != nil {
		return fmt.Errorf("ensure Store operational availability: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1)", storeID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrStoreOperationalAvailabilityNotFound
		}
	}
	return nil
}

type storeAvailabilityRowScanner interface{ Scan(...any) error }

func readStoreOperationalAvailabilityRow(_ context.Context, row storeAvailabilityRowScanner) (StoreOperationalAvailability, error) {
	var result StoreOperationalAvailability
	var scheduleJSON []byte
	if err := row.Scan(&result.StoreID, &result.ScheduleMode, &result.ScheduleTimezone, &scheduleJSON, &result.Paused, &result.PauseReason, &result.PauseUntil, &result.PreparationMinutes, pq.Array(&result.UnavailableFulfillmentModes), &result.Version, &result.UpdatedByActorID, &result.UpdatedAt); err != nil {
		return StoreOperationalAvailability{}, err
	}
	if err := json.Unmarshal(scheduleJSON, &result.WeeklySchedule); err != nil {
		return StoreOperationalAvailability{}, fmt.Errorf("decode Store weekly schedule: %w", err)
	}
	result.WeeklySchedule = canonicalSchedule(result.WeeklySchedule)
	result.UnavailableFulfillmentModes = canonicalModes(result.UnavailableFulfillmentModes)
	return result, nil
}

func validateStoreOperationalAvailabilityInput(input UpdateStoreOperationalAvailabilityInput) error {
	if input.StoreID == "" || input.ExpectedVersion < 1 || input.ActingActorID == "" || len(input.IdempotencyKey) < 8 || len(input.CorrelationID) < 8 {
		return ErrStoreOperationalAvailabilityInvalid
	}
	if input.ScheduleMode != "ALWAYS_OPEN" && input.ScheduleMode != "WEEKLY" {
		return ErrStoreOperationalAvailabilityInvalid
	}
	if input.ScheduleMode == "ALWAYS_OPEN" && len(input.WeeklySchedule) != 0 {
		return ErrStoreOperationalAvailabilityInvalid
	}
	if input.ScheduleMode == "WEEKLY" && len(input.WeeklySchedule) == 0 {
		return ErrStoreOperationalAvailabilityInvalid
	}
	for _, window := range input.WeeklySchedule {
		if window.DayOfWeek < 0 || window.DayOfWeek > 6 || window.OpensAtMinute < 0 || window.OpensAtMinute > 1439 || window.ClosesAtMinute < 1 || window.ClosesAtMinute > 1440 || window.ClosesAtMinute <= window.OpensAtMinute {
			return ErrStoreOperationalAvailabilityInvalid
		}
	}
	if input.Paused {
		if input.PauseReason == nil || len(strings.TrimSpace(*input.PauseReason)) < 2 || len(strings.TrimSpace(*input.PauseReason)) > 500 {
			return ErrStoreOperationalAvailabilityInvalid
		}
	} else if input.PauseReason != nil || input.PauseUntil != nil {
		return ErrStoreOperationalAvailabilityInvalid
	}
	if input.PreparationMinutes != nil && (*input.PreparationMinutes < 1 || *input.PreparationMinutes > 1440) {
		return ErrStoreOperationalAvailabilityInvalid
	}
	if input.AuthoritySource != "STORE_OWNER" && input.AuthoritySource != "STORE_GRANT" && input.AuthoritySource != "OPERATOR" {
		return ErrStoreOperationalAvailabilityInvalid
	}
	for _, mode := range input.UnavailableFulfillmentModes {
		if !validFulfillmentMode(mode) {
			return ErrStoreOperationalAvailabilityInvalid
		}
	}
	return nil
}

func scheduleContains(schedule []StoreScheduleWindow, at time.Time) bool {
	location, err := time.LoadLocation(StoreScheduleTimezone)
	if err != nil {
		return false
	}
	local := at.In(location)
	minute := local.Hour()*60 + local.Minute()
	weekday := int(local.Weekday())
	for _, window := range schedule {
		if window.DayOfWeek == weekday && minute >= window.OpensAtMinute && minute < window.ClosesAtMinute {
			return true
		}
	}
	return false
}

func canonicalSchedule(input []StoreScheduleWindow) []StoreScheduleWindow {
	result := append([]StoreScheduleWindow(nil), input...)
	sort.Slice(result, func(i, j int) bool {
		if result[i].DayOfWeek != result[j].DayOfWeek {
			return result[i].DayOfWeek < result[j].DayOfWeek
		}
		if result[i].OpensAtMinute != result[j].OpensAtMinute {
			return result[i].OpensAtMinute < result[j].OpensAtMinute
		}
		return result[i].ClosesAtMinute < result[j].ClosesAtMinute
	})
	return result
}

func canonicalModes(input []string) []string {
	set := make(map[string]struct{}, len(input))
	for _, value := range input {
		value = strings.TrimSpace(value)
		if value != "" {
			set[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func validFulfillmentMode(mode string) bool {
	return mode == "BTHWANI_CAPTAIN" || mode == "PARTNER_CAPTAIN" || mode == "CUSTOMER_PICKUP"
}
