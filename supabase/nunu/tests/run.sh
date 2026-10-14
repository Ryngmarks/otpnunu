#!/usr/bin/env bash
# Kör databastesterna mot en tom Postgres-databas.
# Använder vanliga PG-variabler (PGHOST, PGPORT, PGUSER, PGPASSWORD).
#   bash supabase/nunu/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=nunu_test_$$
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
$PSQL -d postgres -c "create database $DB"
trap '$PSQL -d postgres -c "drop database if exists $DB" >/dev/null' EXIT

$PSQL -d "$DB" -f supabase-stub.sql
# Användare finns innan 001 körs (så att johan@ryngmarks.com blir medlem)
$PSQL -d "$DB" -c "insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Johan@Ryngmarks.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'anna@nik.se')"
# Två gånger: ska gå att köra om
PGOPTIONS='-c client_min_messages=warning' $PSQL -d "$DB" -f ../001_init.sql
PGOPTIONS='-c client_min_messages=warning' $PSQL -d "$DB" -f ../001_init.sql
$PSQL -d "$DB" -f 001_rls_test.sql 2>&1 | sed -n 's/^psql:[^ ]* \(NOTICE\|ERROR\):  //p; /ALLA SQL-TESTER/p'
