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

// Serving enrollment and recovery use only the verified canonical local
// Identity owner. The database role and namespace are not a second sandbox.
const localDevelopmentOperatorSchema = "identity_test_docker_2e1e6ae0ba6b"

func isLocalDevelopmentFirstOperatorDatabase(ctx context.Context, db *sql.DB, schema string) bool {
	return schema == localDevelopmentOperatorSchema && session.VerifyDevelopmentRuntime(ctx, db, schema) == nil
}

func operatorPasskeyOriginPolicy() session.OperatorPasskeyOriginPolicy {
	return session.OperatorPasskeyOriginPolicy{
		RPID:    os.Getenv("IDENTITY_OPERATOR_PASSKEY_RPID"),
		Origins: strings.Split(os.Getenv("IDENTITY_OPERATOR_PASSKEY_ORIGINS"), ","),
	}
}

func operatorOfflineTicketAdmitted(args []string, isolated, container, bootstrap, local, schema string, policy session.OperatorPasskeyOriginPolicy) bool {
	return len(args) == 1 && args[0] == "issue-local-dev-root-ticket" &&
		isolated == "true" && container == "true" && bootstrap == "true" && local == "true" &&
		schema == localDevelopmentOperatorSchema && policy.AllowsInitialOperatorBootstrap()
}

// Offline, explicitly human-supervised issuance only. No invocation from
// startup, CI, a browser endpoint or an automated task; no ticket in logs.
func runIsolatedInitialOperatorTicket() {
	policy := operatorPasskeyOriginPolicy()
	schema := os.Getenv("IDENTITY_DB_SCHEMA")
	if !operatorOfflineTicketAdmitted(os.Args[1:],
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE"), os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE"),
		os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP"), os.Getenv("IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR"),
		schema, policy) {
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
	if err = db.PingContext(ctx); err != nil || !isLocalDevelopmentFirstOperatorDatabase(ctx, db, schema) {
		log.Fatal("local Root ticket issuance requires exact existing development Identity owner")
	}
	owner, err := session.NewPostgresReader(db, schema)
	if err != nil {
		log.Fatal("isolated Identity scope rejected")
	}
	auth, err := session.NewOperatorPasskeyAuth(owner, policy, true)
	if err != nil {
		log.Fatal("isolated WebAuthn relying-party invalid")
	}
	if err := auth.AllowLocalDevelopmentFirstOwner(); err != nil {
		log.Fatal("local development First Operator configuration refused")
	}
	ticket, err := auth.IssueInitialOperatorTicket(ctx)
	if err != nil {
		log.Fatal("first-Operator bootstrap refused; verify empty isolated Owner and migrations")
	}
	fmt.Println(ticket)
}
