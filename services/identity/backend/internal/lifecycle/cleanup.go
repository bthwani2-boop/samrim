package lifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

const defaultInterval = time.Hour

type RetentionConfig struct {
	Challenge          time.Duration
	PasswordAttempt    time.Duration
	OperatorEnrollment time.Duration
	Session            time.Duration
	Audit              time.Duration
	BatchSize          int
}

func DefaultRetentionConfig() RetentionConfig {
	return RetentionConfig{
		Challenge:          30 * 24 * time.Hour,
		PasswordAttempt:    30 * 24 * time.Hour,
		OperatorEnrollment: 30 * 24 * time.Hour,
		Session:            90 * 24 * time.Hour,
		Audit:              365 * 24 * time.Hour,
		BatchSize:          500,
	}
}

func ConfigFromEnvironment(getenv func(string) string, requireExplicit bool) (RetentionConfig, error) {
	config := DefaultRetentionConfig()
	values := []struct {
		name   string
		target *time.Duration
	}{
		{"IDENTITY_RETENTION_CHALLENGE_DAYS", &config.Challenge},
		{"IDENTITY_RETENTION_PASSWORD_ATTEMPT_DAYS", &config.PasswordAttempt},
		{"IDENTITY_RETENTION_OPERATOR_ENROLLMENT_DAYS", &config.OperatorEnrollment},
		{"IDENTITY_RETENTION_SESSION_DAYS", &config.Session},
		{"IDENTITY_RETENTION_AUDIT_DAYS", &config.Audit},
	}
	for _, value := range values {
		raw := strings.TrimSpace(getenv(value.name))
		if raw == "" {
			if requireExplicit {
				return RetentionConfig{}, fmt.Errorf("%s is required outside local environments", value.name)
			}
			continue
		}
		days, err := strconv.Atoi(raw)
		if err != nil || days <= 0 {
			return RetentionConfig{}, fmt.Errorf("%s must be a positive integer number of days", value.name)
		}
		*value.target = time.Duration(days) * 24 * time.Hour
	}
	rawBatch := strings.TrimSpace(getenv("IDENTITY_RETENTION_BATCH_SIZE"))
	if rawBatch != "" {
		batchSize, err := strconv.Atoi(rawBatch)
		if err != nil || batchSize <= 0 || batchSize > 10_000 {
			return RetentionConfig{}, fmt.Errorf("IDENTITY_RETENTION_BATCH_SIZE must be between 1 and 10000")
		}
		config.BatchSize = batchSize
	} else if requireExplicit {
		return RetentionConfig{}, fmt.Errorf("IDENTITY_RETENTION_BATCH_SIZE is required outside local environments")
	}
	return config, nil
}

type Cleaner struct {
	db       *sql.DB
	interval time.Duration
	config   RetentionConfig
}

type retentionStatement struct {
	name           string
	query          string
	remainingQuery string
	age            time.Duration
}

func New(db *sql.DB, config RetentionConfig) *Cleaner {
	return &Cleaner{db: db, interval: defaultInterval, config: config}
}

func (c *Cleaner) Run(ctx context.Context) {
	if err := c.runOnce(ctx); err != nil {
		log.Printf("identity retention cleanup: %v", err)
	}
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.runOnce(ctx); err != nil {
				log.Printf("identity retention cleanup: %v", err)
			}
		}
	}
}

func (c *Cleaner) runOnce(ctx context.Context) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var lockAcquired bool
	if err := tx.QueryRowContext(
		ctx,
		"SELECT pg_try_advisory_xact_lock(hashtextextended('identity:retention-cleanup', 0))",
	).Scan(&lockAcquired); err != nil {
		return fmt.Errorf("identity retention cleanup lock: %w", err)
	}
	if !lockAcquired {
		return nil
	}

	statements := []retentionStatement{
		{
			name: "challenge_deliveries",
			query: `DELETE FROM identity_challenge_deliveries
WHERE challenge_id IN (
  SELECT d.challenge_id
  FROM identity_challenge_deliveries d
  JOIN identity_challenges c ON c.id=d.challenge_id
  WHERE c.created_at < clock_timestamp() - $1 * INTERVAL '1 second'
  ORDER BY c.created_at,d.challenge_id
  LIMIT $2
)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_challenge_deliveries d
  JOIN identity_challenges c ON c.id=d.challenge_id
  WHERE c.created_at < clock_timestamp() - $1 * INTERVAL '1 second'
)`,
			age: c.config.Challenge,
		},
		{
			name: "challenges",
			query: `DELETE FROM identity_challenges
WHERE id IN (
  SELECT c.id
  FROM identity_challenges c
  WHERE c.created_at < clock_timestamp() - $1 * INTERVAL '1 second'
    AND NOT EXISTS (SELECT 1 FROM identity_challenge_deliveries d WHERE d.challenge_id=c.id)
  ORDER BY c.created_at,c.id
  LIMIT $2
)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_challenges c
  WHERE c.created_at < clock_timestamp() - $1 * INTERVAL '1 second'
    AND NOT EXISTS (SELECT 1 FROM identity_challenge_deliveries d WHERE d.challenge_id=c.id)
)`,
			age: c.config.Challenge,
		},
		{
			name: "operator_enrollment_tokens",
			query: `DELETE FROM identity_operator_enrollment_tokens
WHERE id IN (SELECT id FROM identity_operator_enrollment_tokens WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second' ORDER BY created_at,id LIMIT $2)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_operator_enrollment_tokens
  WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'
)`,
			age: c.config.OperatorEnrollment,
		},
		{
			name: "password_attempts",
			query: `DELETE FROM identity_password_attempts
WHERE id IN (SELECT id FROM identity_password_attempts WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second' ORDER BY created_at,id LIMIT $2)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_password_attempts
  WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'
)`,
			age: c.config.PasswordAttempt,
		},
		{
			name: "refresh_token_history",
			query: `DELETE FROM identity_refresh_token_history
WHERE (session_id,token_hash) IN (SELECT session_id,token_hash FROM identity_refresh_token_history WHERE rotated_at < clock_timestamp() - $1 * INTERVAL '1 second' ORDER BY rotated_at,session_id,token_hash LIMIT $2)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_refresh_token_history
  WHERE rotated_at < clock_timestamp() - $1 * INTERVAL '1 second'
)`,
			age: c.config.Session,
		},
		{
			name: "sessions",
			query: `DELETE FROM identity_sessions
WHERE id IN (SELECT id FROM identity_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < clock_timestamp() - $1 * INTERVAL '1 second') OR absolute_expires_at < clock_timestamp() - $1 * INTERVAL '1 second' ORDER BY created_at,id LIMIT $2)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_sessions
  WHERE (revoked_at IS NOT NULL AND revoked_at < clock_timestamp() - $1 * INTERVAL '1 second')
     OR absolute_expires_at < clock_timestamp() - $1 * INTERVAL '1 second'
)`,
			age: c.config.Session,
		},
		{
			name: "security_audit",
			query: `DELETE FROM identity_security_audit
WHERE id IN (SELECT id FROM identity_security_audit WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second' ORDER BY created_at,id LIMIT $2)`,
			remainingQuery: `SELECT EXISTS (
  SELECT 1
  FROM identity_security_audit
  WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'
)`,
			age: c.config.Audit,
		},
	}
	counts := make([]string, 0, len(statements))
	limitReached := make([]string, 0, len(statements))
	backlog := make([]string, 0, len(statements))
	for _, statement := range statements {
		result, err := tx.ExecContext(ctx, statement.query, statement.age.Seconds(), c.config.BatchSize)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count > 0 {
			counts = append(counts, fmt.Sprintf("%s=%d", statement.name, count))
		}
		if count == int64(c.config.BatchSize) {
			limitReached = append(limitReached, statement.name)
			var remaining bool
			if err := tx.QueryRowContext(ctx, statement.remainingQuery, statement.age.Seconds()).Scan(&remaining); err != nil {
				return err
			}
			if remaining {
				backlog = append(backlog, statement.name)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Printf(
		"identity retention cleanup batch: batch_size=%d deleted=%s limit_reached=%s backlog_remaining=%s",
		c.config.BatchSize,
		strings.Join(counts, ","),
		strings.Join(limitReached, ","),
		strings.Join(backlog, ","),
	)
	return nil
}
