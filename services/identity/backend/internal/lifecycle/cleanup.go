package lifecycle

import (
	"context"
	"database/sql"
	"log"
	"time"
)

const (
	defaultInterval          = time.Hour
	challengeRetention       = 30 * 24 * time.Hour
	passwordAttemptRetention = 30 * 24 * time.Hour
	activationRetention      = 30 * 24 * time.Hour
	sessionRetention         = 90 * 24 * time.Hour
	auditRetention           = 365 * 24 * time.Hour
)

type Cleaner struct {
	db       *sql.DB
	interval time.Duration
}

func New(db *sql.DB) *Cleaner {
	return &Cleaner{db: db, interval: defaultInterval}
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
	statements := []struct {
		query string
		age   time.Duration
	}{
		{"DELETE FROM identity_challenge_deliveries WHERE challenge_id IN (SELECT id FROM identity_challenges WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second')", challengeRetention},
		{"DELETE FROM identity_challenges WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'", challengeRetention},
		{"DELETE FROM identity_managed_activation_codes WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'", activationRetention},
		{"DELETE FROM identity_password_attempts WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'", passwordAttemptRetention},
		{"DELETE FROM identity_refresh_token_history WHERE rotated_at < clock_timestamp() - $1 * INTERVAL '1 second'", sessionRetention},
		{"DELETE FROM identity_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < clock_timestamp() - $1 * INTERVAL '1 second') OR absolute_expires_at < clock_timestamp() - $1 * INTERVAL '1 second'", sessionRetention},
		{"DELETE FROM identity_security_audit WHERE created_at < clock_timestamp() - $1 * INTERVAL '1 second'", auditRetention},
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement.query, statement.age.Seconds()); err != nil {
			return err
		}
	}
	return tx.Commit()
}
