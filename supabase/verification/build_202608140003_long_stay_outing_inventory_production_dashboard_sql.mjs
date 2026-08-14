import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migrationSha = "6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9";
const productionRef = "zorvcuskzemehblqdbfj";
const cleanQaRef = "wxbvwixoeczfvbqurdse";
const outputDirectory = resolve(root, "supabase/qa/long-stay-outing-inventory-production");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const binding = `
-- PRODUCTION_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','${productionRef}',true);
select set_config('app.release_migration_sha256','${migrationSha}',true);
do $production_dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from '${productionRef}'
    or current_setting('app.release_project_ref',true)='${cleanQaRef}'
    or current_setting('app.release_migration_sha256',true) is distinct from '${migrationSha}'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_PRODUCTION_DASHBOARD_BINDING';
  end if;
end;
$production_dashboard_binding$;
-- PRODUCTION_DASHBOARD_BINDING_END
`;

const existingDomainBaseline = `
-- EXISTING_DOMAIN_BASELINE_BEGIN
do $existing_domain_baseline$
begin
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_month_v2(date)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_LONG_STAY_BASELINE';
  end if;
  if to_regclass('public.hotel_physical_occupancies') is null
    or to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_SHARED_ROOM_BASELINE';
  end if;
  if to_regclass('public.daycare_operation_states') is null
    or to_regprocedure('public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_DAYCARE_BASELINE';
  end if;
  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb'
    or (select p.provolatile from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure)<>'s' then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_HOTEL_BASELINE';
  end if;
  if md5((select pg_get_constraintdef(c.oid,true) from pg_constraint c
      where c.conrelid='public.sales'::regclass and c.conname='sales_payment_plan_limit'))
      <>'83538462481fcd9bd9972238587572e2' then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_FINANCE_BASELINE';
  end if;
end;
$existing_domain_baseline$;
-- EXISTING_DOMAIN_BASELINE_END
`;

const phases = [
  ["PREFLIGHT", "supabase/verification/202608140003_long_stay_outing_inventory_v1_preflight.sql", "long_stay_outing_inventory_production_dashboard_preflight.sql", "begin read only;", true],
  ["MIGRATION", "supabase/migrations/202608140003_long_stay_outing_inventory_v1.sql", "long_stay_outing_inventory_production_dashboard_migration.sql", "begin;", false],
  ["POSTFLIGHT", "supabase/verification/202608140003_long_stay_outing_inventory_v1_postflight.sql", "long_stay_outing_inventory_production_dashboard_postflight.sql", "begin read only;", true],
];

mkdirSync(outputDirectory, { recursive: true });
for (const [phase, sourcePath, outputName, transactionStart, includeBaseline] of phases) {
  const source = readFileSync(resolve(root, sourcePath), "utf8");
  if (sourcePath.includes("migrations/") && sha256(source) !== migrationSha) {
    throw new Error("Approved Long Stay outing inventory migration SHA mismatch");
  }
  let dashboardSource = source.replace(/^\\set ON_ERROR_STOP on\n/m, "");
  dashboardSource = dashboardSource
    .replace(/^-- CLEAN QA ONLY\. Read-only (preflight|postflight)\.\n/m, "")
    .replace(/^select hotel_qa\.assert_isolated_environment\(\);\n/m, "");
  if (dashboardSource.includes("hotel_qa.assert_isolated_environment")) {
    throw new Error(`${phase} retained a Clean QA-only assertion`);
  }
  const occurrenceCount = dashboardSource.split(transactionStart).length - 1;
  if (occurrenceCount !== 1) throw new Error(`${phase} transaction boundary is not exact`);
  const inserted = `${transactionStart}${binding}${includeBaseline ? existingDomainBaseline : ""}`;
  const wrapped = dashboardSource.replace(transactionStart, inserted);
  const header = [
    "-- GENERATED FILE: do not edit or assemble by hand.",
    `-- Dashboard phase: ${phase}`,
    `-- Production exact project: ${productionRef}`,
    `-- Clean QA project ${cleanQaRef} is rejected before any mutation.`,
    `-- Approved migration SHA-256: ${migrationSha}`,
    `-- Embedded source SHA-256: ${sha256(source)}`,
    "",
  ].join("\n");
  writeFileSync(resolve(outputDirectory, outputName), `${header}${wrapped}`);
}
