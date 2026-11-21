package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	_ "github.com/lib/pq"
)

const initialOperatorDatabase = "refoundation_webauthn_s02"

func operatorPasskeyOriginPolicy() session.OperatorPasskeyOriginPolicy {
	return session.OperatorPasskeyOriginPolicy{
		RPID:    os.Getenv("IDENTITY_OPERATOR_PASSKEY_RPID"),
		Origins: strings.Split(os.Getenv("IDENTITY_OPERATOR_PASSKEY_ORIGINS"), ","),
	}
}

func isInitialOperatorDatabase(ctx context.Context, db *sql.DB) bool {
	var actualDB string
	err := db.QueryRowContext(ctx, "SELECT current_database()").Scan(&actualDB)
	return err == nil && actualDB == initialOperatorDatabase
}

// This is an OFFLINE, explicitly invoked synthetic-development tool.
// It refuses all existing Operator roles and protected Identity namespaces.
// Do not run in CI, logs, automated startup, or shared production environments.
func runIsolatedInitialOperatorTicket() {
	policy := operatorPasskeyOriginPolicy()
	if len(os.Args) != 2 || os.Args[1] != "issue-synthetic-root-ticket" ||
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP") != "true" ||
		!policy.AllowsInitialOperatorBootstrap() ||
		!session.IsIsolatedTestSchema(os.Getenv("IDENTITY_DB_SCHEMA")) {
		log.Fatal("initial Operator ticket issuance requires explicit isolated authorization")
	}
	dsn := os.Getenv("IDENTITY_TEST_DATABASE_URL")
	if dsn == "" {
		log.Fatal("isolated database configuration unavailable")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("isolated database driver unavailable")
	}
	defer db.Close()
	db.SetMaxOpenConns(2)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		log.Fatal("isolated Identity owner unreachable")
	}
	// The offline issuer is only for the dedicated disposable WebAuthn
	// development database. A synthetic schema name inside a protected
	// shared database is NOT sufficient evidence of disposable authority.
	if !isInitialOperatorDatabase(ctx, db) {
		log.Fatal("offline Root ticket issuer refuses non-disposable database")
	}
	owner, err := session.NewPostgresReader(db, os.Getenv("IDENTITY_DB_SCHEMA"))
	if err != nil {
		log.Fatal("isolated Identity scope rejected")
	}
	auth, err := session.NewOperatorPasskeyAuth(owner, policy, true)
	if err != nil {
		log.Fatal("isolated WebAuthn relying-party invalid")
	}
	ticket, err := auth.IssueInitialOperatorTicket(ctx)
	if err != nil {
		// Do not print actor IDs, identity existence, or backing SQL details.
		log.Fatal("first-Operator bootstrap refused; verify empty isolated Owner and migrations")
	}
	// One-time 10-minute secret. Requires a directly supervised local terminal;
	// never paste it into chat, logs or command arguments.
	fmt.Println(ticket)
}
