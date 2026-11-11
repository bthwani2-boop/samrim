#!/bin/sh
# Fail closed on real database login, role isolation and sensitive privileges.
set -eu
export PGHOST=postgres PGPORT=5432

role_sql() {
  user="$1"
  password="$2"
  statement="$3"
  PGUSER="$user" PGPASSWORD="$password" psql -X -A -t -v ON_ERROR_STOP=1 -c "$statement"
}
assert_true() {
  result="$(role_sql "$1" "$2" "$3")"
  if [ "$result" != t ]; then
    echo "RUNTIME_ROLE_PROOF_FAIL role=$1 check=$4" >&2
    exit 1
  fi
}
assert_denied() {
  if role_sql "$1" "$2" "$3" >/dev/null 2>&1; then
    echo "RUNTIME_ROLE_PROOF_FAIL role=$1 check=$4" >&2
    exit 1
  fi
}

assert_true samrim_identity_runtime "$SAMRIM_IDENTITY_DB_PASSWORD" "SELECT has_table_privilege(current_user,'public.identity_actors','SELECT') AND has_table_privilege(current_user,'public.identity_actors','INSERT') AND has_table_privilege(current_user,'public.identity_actors','UPDATE') AND NOT has_table_privilege(current_user,'public.identity_security_audit','UPDATE') AND NOT has_table_privilege(current_user,'public.identity_schema_migrations','INSERT')" identity_runtime
assert_true samrim_identity_maintenance "$SAMRIM_IDENTITY_MAINTENANCE_DB_PASSWORD" "SELECT has_table_privilege(current_user,'public.identity_security_audit','DELETE') AND NOT has_table_privilege(current_user,'public.identity_security_audit','INSERT')" identity_maintenance
assert_true samrim_dsh_runtime "$SAMRIM_DSH_DB_PASSWORD" "SELECT has_table_privilege(current_user,'dsh.stores','SELECT') AND has_table_privilege(current_user,'dsh.stores','INSERT') AND has_table_privilege(current_user,'dsh.stores','UPDATE') AND has_table_privilege(current_user,'dsh.stores','DELETE')" dsh_runtime
assert_true samrim_wlt_runtime "$SAMRIM_WLT_DB_PASSWORD" "SELECT has_table_privilege(current_user,'wlt.payment_intents','SELECT') AND has_table_privilege(current_user,'wlt.payment_intents','INSERT') AND has_table_privilege(current_user,'wlt.payment_intents','UPDATE') AND has_table_privilege(current_user,'wlt.payment_intents','DELETE')" wlt_runtime

assert_denied samrim_identity_runtime "$SAMRIM_IDENTITY_DB_PASSWORD" 'SELECT id FROM wlt.payment_intents LIMIT 0' identity_finance_denied
assert_denied samrim_dsh_runtime "$SAMRIM_DSH_DB_PASSWORD" 'SELECT id FROM wlt.payment_intents LIMIT 0' dsh_finance_denied
assert_denied samrim_wlt_runtime "$SAMRIM_WLT_DB_PASSWORD" 'SELECT id FROM dsh.stores LIMIT 0' wlt_dsh_denied
assert_denied samrim_identity_maintenance "$SAMRIM_IDENTITY_MAINTENANCE_DB_PASSWORD" 'SELECT id FROM dsh.stores LIMIT 0' maintenance_dsh_denied
echo 'RUNTIME_DATABASE_ACCESS=PASS principals=4 denied_cross_owner=4'
