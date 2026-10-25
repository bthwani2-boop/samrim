package hr

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var attendanceDayPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type AttendanceInput struct {
	Date            string `json:"date"`
	Status          string `json:"status"`
	Note            string `json:"note"`
	CheckInAt       string `json:"checkInAt,omitempty"`
	CheckOutAt      string `json:"checkOutAt,omitempty"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type AttendanceRecord struct {
	EmployeeID        string     `json:"employeeId"`
	Date              string     `json:"date"`
	Status            string     `json:"status"`
	Note              string     `json:"note"`
	CheckInAt         *time.Time `json:"checkInAt,omitempty"`
	CheckOutAt        *time.Time `json:"checkOutAt,omitempty"`
	Version           int        `json:"version"`
	RecordedByActorID string     `json:"recordedByActorId"`
	RecordedAt        time.Time  `json:"recordedAt"`
}
type AttendanceResult struct {
	Record           AttendanceRecord `json:"record"`
	IdempotentReplay bool             `json:"idempotentReplay"`
}
type AttendancePage struct {
	Items []AttendanceRecord `json:"items"`
}

func parseAttendanceDay(value string) (time.Time, error) {
	if !attendanceDayPattern.MatchString(value) {
		return time.Time{}, ErrInvalid
	}
	date, err := time.Parse("2006-01-02", value)
	if err != nil || date.Format("2006-01-02") != value {
		return time.Time{}, ErrInvalid
	}
	return date, nil
}
func normalizeAttendance(in AttendanceInput) (AttendanceInput, *time.Time, *time.Time, error) {
	in.Note = strings.TrimSpace(in.Note)
	_, err := parseAttendanceDay(in.Date)
	if err != nil || utf8.RuneCountInString(in.Note) < 8 || utf8.RuneCountInString(in.Note) > 500 || in.ExpectedVersion < 0 {
		return AttendanceInput{}, nil, nil, ErrInvalid
	}
	switch in.Status {
	case "present", "absent", "late", "leave":
	default:
		return AttendanceInput{}, nil, nil, ErrInvalid
	}
	if (in.CheckInAt == "") != (in.CheckOutAt == "") {
		return AttendanceInput{}, nil, nil, ErrInvalid
	}
	if in.CheckInAt == "" {
		return in, nil, nil, nil
	}
	if in.Status != "present" && in.Status != "late" {
		return AttendanceInput{}, nil, nil, ErrInvalid
	}
	start, e1 := time.Parse(time.RFC3339, in.CheckInAt)
	finish, e2 := time.Parse(time.RFC3339, in.CheckOutAt)
	if e1 != nil || e2 != nil || !finish.After(start) || finish.Sub(start) > 36*time.Hour {
		return AttendanceInput{}, nil, nil, ErrInvalid
	}
	// The attendance date is the start of the shift in Yemen, even when a
	// shift crosses midnight. Timestamps are preserved in UTC in storage.
	if start.In(time.FixedZone("Asia/Aden", 3*60*60)).Format("2006-01-02") != in.Date {
		return AttendanceInput{}, nil, nil, ErrInvalid
	}
	in.CheckInAt = start.UTC().Format(time.RFC3339)
	in.CheckOutAt = finish.UTC().Format(time.RFC3339)
	return in, &start, &finish, nil
}

func attendanceAllowedForEmployment(day, status string, start time.Time) bool {
	return status == "active" && day >= start.Format("2006-01-02")
}

type attendanceScanner interface{ Scan(...any) error }

func scanAttendance(row attendanceScanner) (AttendanceRecord, error) {
	var a AttendanceRecord
	var day time.Time
	var checkIn, checkOut sql.NullTime
	err := row.Scan(&a.EmployeeID, &day, &a.Status, &a.Note, &checkIn, &checkOut, &a.Version, &a.RecordedByActorID, &a.RecordedAt)
	if err != nil {
		return a, err
	}
	a.Date = day.Format("2006-01-02")
	if checkIn.Valid {
		v := checkIn.Time
		a.CheckInAt = &v
	}
	if checkOut.Valid {
		v := checkOut.Time
		a.CheckOutAt = &v
	}
	return a, nil
}

const attendanceColumns = "employee_id,attendance_date,status,note,check_in_at,check_out_at,version,recorded_by_actor_id,recorded_at"

func RecordAttendance(ctx context.Context, db *sql.DB, employeeID string, input AttendanceInput, acting, correlation, idem string) (AttendanceResult, error) {
	input, start, finish, err := normalizeAttendance(input)
	if err != nil {
		return AttendanceResult{}, err
	}
	if db == nil || !strings.HasPrefix(employeeID, "emp_") || len(employeeID) != 36 ||
		len(acting) < 1 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idem) < 8 || len(idem) > 128 {
		return AttendanceResult{}, ErrInvalid
	}
	raw, _ := json.Marshal(input)
	sum := sha256.Sum256(append([]byte(acting+":"+employeeID+":"), raw...))
	digest := hex.EncodeToString(sum[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return AttendanceResult{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:attendance:"+employeeID+":"+input.Date); err != nil {
		return AttendanceResult{}, err
	}
	// Global unique key also prevents one key being reused for a different date.
	var previousID, hash string
	err = tx.QueryRowContext(ctx, "SELECT employee_id,request_hash FROM dsh.hr_attendance_events WHERE idempotency_key=$1", idem).Scan(&previousID, &hash)
	if err == nil {
		if previousID != employeeID || hash != digest {
			return AttendanceResult{}, ErrConflict
		}
		item, e := scanAttendance(tx.QueryRowContext(ctx, "SELECT employee_id,attendance_date,status,note,check_in_at,check_out_at,version,acting_actor_id,created_at FROM dsh.hr_attendance_events WHERE idempotency_key=$1", idem))
		if e != nil {
			return AttendanceResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return AttendanceResult{}, e
		}
		return AttendanceResult{Record: item, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AttendanceResult{}, err
	}
	var employmentStatus string
	var employmentStart time.Time
	err = tx.QueryRowContext(ctx, "SELECT status,start_date FROM dsh.hr_employees WHERE id=$1 FOR SHARE", employeeID).Scan(&employmentStatus, &employmentStart)
	if errors.Is(err, sql.ErrNoRows) {
		return AttendanceResult{}, ErrNotFound
	}
	if err != nil {
		return AttendanceResult{}, err
	}
	if !attendanceAllowedForEmployment(input.Date, employmentStatus, employmentStart) {
		return AttendanceResult{}, ErrConflict
	}
	var currentVersion int
	err = tx.QueryRowContext(ctx, "SELECT version FROM dsh.hr_attendance_records WHERE employee_id=$1 AND attendance_date=$2::date FOR UPDATE", employeeID, input.Date).Scan(&currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		currentVersion = 0
	} else if err != nil {
		return AttendanceResult{}, err
	}
	if currentVersion != input.ExpectedVersion {
		return AttendanceResult{}, ErrConflict
	}
	// The advisory lock plus optimistic version prevents concurrent corrections from overwriting one another.
	var checkIn, checkOut any
	if start != nil {
		checkIn = start.UTC()
		checkOut = finish.UTC()
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_attendance_records
 (employee_id,attendance_date,status,note,check_in_at,check_out_at,version,recorded_by_actor_id)
 VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(employee_id,attendance_date) DO UPDATE
 SET status=EXCLUDED.status,note=EXCLUDED.note,check_in_at=EXCLUDED.check_in_at,check_out_at=EXCLUDED.check_out_at,
 version=EXCLUDED.version,recorded_by_actor_id=EXCLUDED.recorded_by_actor_id,recorded_at=clock_timestamp()`,
		employeeID, input.Date, input.Status, input.Note, checkIn, checkOut, currentVersion+1, acting)
	if err != nil {
		return AttendanceResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_attendance_events
 (idempotency_key,employee_id,attendance_date,request_hash,acting_actor_id,correlation_id,status,note,check_in_at,check_out_at,version)
 VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
		idem, employeeID, input.Date, digest, acting, correlation, input.Status, input.Note, checkIn, checkOut, currentVersion+1)
	if err != nil {
		return AttendanceResult{}, err
	}
	item, err := scanAttendance(tx.QueryRowContext(ctx, "SELECT "+attendanceColumns+" FROM dsh.hr_attendance_records WHERE employee_id=$1 AND attendance_date=$2::date", employeeID, input.Date))
	if err != nil {
		return AttendanceResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return AttendanceResult{}, err
	}
	return AttendanceResult{Record: item}, nil
}
func ListAttendance(ctx context.Context, db *sql.DB, employeeID, from, to string) (AttendancePage, error) {
	start, e1 := parseAttendanceDay(from)
	end, e2 := parseAttendanceDay(to)
	if db == nil || !strings.HasPrefix(employeeID, "emp_") || len(employeeID) != 36 || e1 != nil || e2 != nil || end.Before(start) || end.Sub(start) > 31*24*time.Hour {
		return AttendancePage{}, ErrInvalid
	}
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.hr_employees WHERE id=$1)", employeeID).Scan(&exists); err != nil {
		return AttendancePage{}, err
	}
	if !exists {
		return AttendancePage{}, ErrNotFound
	}
	rows, err := db.QueryContext(ctx, "SELECT "+attendanceColumns+" FROM dsh.hr_attendance_records WHERE employee_id=$1 AND attendance_date BETWEEN $2::date AND $3::date ORDER BY attendance_date DESC", employeeID, from, to)
	if err != nil {
		return AttendancePage{}, err
	}
	defer rows.Close()
	result := AttendancePage{Items: []AttendanceRecord{}}
	for rows.Next() {
		item, e := scanAttendance(rows)
		if e != nil {
			return AttendancePage{}, e
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}
