package postgres

import (
	"context"
	"database/sql"
	"fmt"
)

type tablePrivilegeRequirement struct {
	table      string
	privileges []string
}

var identityRuntimePrivileges = []tablePrivilegeRequirement{
	{table: "identity_actors", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_actor_roles", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_password_credentials", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_challenges", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_challenge_deliveries", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_managed_activation_codes", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_sessions", privileges: []string{"SELECT", "INSERT", "UPDATE"}},
	{table: "identity_refresh_token_history", privileges: []string{"SELECT", "INSERT"}},
	{table: "identity_password_attempts", privileges: []string{"SELECT", "INSERT", "UPDATE", "DELETE"}},
	{table: "identity_security_audit", privileges: []string{"SELECT", "INSERT"}},
	{table: "identity_schema_migrations", privileges: []string{"SELECT"}},
}

var identityMaintenancePrivileges = []tablePrivilegeRequirement{
	{table: "identity_challenge_deliveries", privileges: []string{"SELECT", "DELETE"}},
	{table: "identity_challenges", privileges: []string{"SELECT", "DELETE"}},
	{table: "identity_managed_activation_codes", privileges: []string{"SELECT", "DELETE"}},
	{table: "identity_password_attempts", privileges: []string{"SELECT", "DELETE"}},
	{table: "identity_refresh_token_history", privileges: []string{"SELECT", "DELETE"}},
	{table: "identity_sessions", privileges: []string{"SELECT", "DELETE"}},
	{table: "identity_security_audit", privileges: []string{"SELECT", "DELETE"}},
}

func VerifyRuntimePrivileges(ctx context.Context, db *sql.DB) error {
	if err := verifyNonOwnerNoDDL(ctx, db, "runtime"); err != nil {
		return err
	}
	for _, requirement := range identityRuntimePrivileges {
		for _, privilege := range requirement.privileges {
			if err := requireTablePrivilege(ctx, db, requirement.table, privilege, true); err != nil {
				return fmt.Errorf("identity runtime role: %w", err)
			}
		}
	}
	for _, privilege := range []string{"UPDATE", "DELETE", "TRUNCATE"} {
		if err := requireTablePrivilege(ctx, db, "identity_security_audit", privilege, false); err != nil {
			return fmt.Errorf("identity runtime audit boundary: %w", err)
		}
	}
	for _, privilege := range []string{"INSERT", "UPDATE", "DELETE", "TRUNCATE"} {
		if err := requireTablePrivilege(ctx, db, "identity_schema_migrations", privilege, false); err != nil {
			return fmt.Errorf("identity runtime migration boundary: %w", err)
		}
	}
	return nil
}

func VerifyMaintenancePrivileges(ctx context.Context, db *sql.DB) error {
	if err := verifyNonOwnerNoDDL(ctx, db, "maintenance"); err != nil {
		return err
	}
	for _, requirement := range identityMaintenancePrivileges {
		for _, privilege := range requirement.privileges {
			if err := requireTablePrivilege(ctx, db, requirement.table, privilege, true); err != nil {
				return fmt.Errorf("identity maintenance role: %w", err)
			}
		}
	}
	for _, privilege := range []string{"INSERT", "UPDATE", "TRUNCATE"} {
		if err := requireTablePrivilege(ctx, db, "identity_security_audit", privilege, false); err != nil {
			return fmt.Errorf("identity maintenance audit boundary: %w", err)
		}
	}
	return nil
}

func verifyNonOwnerNoDDL(ctx context.Context, db *sql.DB, label string) error {
	var currentUser string
	var schemaCreate, databaseCreate, ownsIdentityTables bool
	if err := db.QueryRowContext(ctx, `
SELECT current_user,
       has_schema_privilege(current_user, 'public', 'CREATE'),
       has_database_privilege(current_user, current_database(), 'CREATE'),
       EXISTS (
         SELECT 1
         FROM pg_class c
         JOIN pg_namespace n ON n.oid=c.relnamespace
         JOIN pg_roles r ON r.oid=c.relowner
         WHERE n.nspname='public' AND c.relname LIKE 'identity_%' AND r.rolname=current_user
       )`).Scan(&currentUser, &schemaCreate, &databaseCreate, &ownsIdentityTables); err != nil {
		return fmt.Errorf("%s principal boundary lookup: %w", label, err)
	}
	if schemaCreate || databaseCreate || ownsIdentityTables {
		return fmt.Errorf("%s database principal %q has DDL or ownership authority", label, currentUser)
	}
	return nil
}

func requireTablePrivilege(ctx context.Context, db *sql.DB, table, privilege string, required bool) error {
	var granted bool
	if err := db.QueryRowContext(ctx, "SELECT has_table_privilege(current_user, $1, $2)", "public."+table, privilege).Scan(&granted); err != nil {
		return fmt.Errorf("table privilege lookup %s.%s: %w", table, privilege, err)
	}
	if granted != required {
		if required {
			return fmt.Errorf("missing table privilege %s.%s", table, privilege)
		}
		return fmt.Errorf("forbidden table privilege %s.%s", table, privilege)
	}
	return nil
}
