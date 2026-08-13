import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const productionRef = "zorvcuskzemehblqdbfj";
const cleanQaRef = "wxbvwixoeczfvbqurdse";
const migrationName = "202608130005_hotel_lifecycle_consistency.sql";
const migrationPath = resolve(directory, "../migrations", migrationName);
const migration = readFileSync(migrationPath, "utf8");
const migrationSha = createHash("sha256").update(migration).digest("hex");

function body(sql, start, end) {
  const startIndex = sql.indexOf(`${start}\n`);
  const endIndex = sql.lastIndexOf(`\n${end}`);
  if (startIndex<0 || endIndex<0) throw new Error(`Missing ${start}/${end}`);
  return sql.slice(startIndex+start.length+1,endIndex);
}

function verification(phase) {
  const sourceName = `202608130005_hotel_lifecycle_consistency_production_${phase}.sql`;
  const source = readFileSync(resolve(directory,sourceName),"utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  return `-- GENERATED; do not edit or assemble by hand.\n-- Production ${productionRef}; Clean QA ${cleanQaRef} is rejected.\n-- Approved source SHA-256: ${sourceSha}\n-- Migration SHA-256: ${migrationSha}\n${phase==='preflight'?'begin read only;':'begin read only;'}\nselect set_config('app.release_project_ref','${productionRef}',true);\nselect set_config('app.release_migration_sha256','${migrationSha}',true);\n-- APPROVED_SOURCE_BODY_BEGIN: ${phase.toUpperCase()}\n${body(source,'begin read only;','rollback;')}\n-- APPROVED_SOURCE_BODY_END: ${phase.toUpperCase()}\nrollback;\n`;
}

const migrationDashboard = `-- GENERATED; do not edit or assemble by hand.\n-- Production ${productionRef}; Clean QA ${cleanQaRef} is rejected.\n-- Migration SHA-256: ${migrationSha}\nbegin;\nselect set_config('app.release_project_ref','${productionRef}',true);\nselect set_config('app.release_migration_sha256','${migrationSha}',true);\ndo $binding$ begin\n  if current_setting('app.release_project_ref',true) is distinct from '${productionRef}'\n    or current_setting('app.release_project_ref',true)='${cleanQaRef}'\n    or current_setting('app.release_migration_sha256',true) is distinct from '${migrationSha}'\n    or current_database()<>'postgres' or current_user<>'postgres'\n    or to_regclass('hotel_qa.environment_guard') is not null then\n    raise exception 'STOP_HOTEL_LIFECYCLE_PRODUCTION_BINDING';\n  end if;\nend; $binding$;\n-- APPROVED_SOURCE_BODY_BEGIN: MIGRATION\n${body(migration,'begin;','commit;')}\n-- APPROVED_SOURCE_BODY_END: MIGRATION\ncommit;\n`;

writeFileSync(resolve(directory,"202608130005_hotel_lifecycle_consistency_dashboard_preflight.sql"),verification("preflight"));
writeFileSync(resolve(directory,"202608130005_hotel_lifecycle_consistency_dashboard_migration.sql"),migrationDashboard);
writeFileSync(resolve(directory,"202608130005_hotel_lifecycle_consistency_dashboard_postflight.sql"),verification("postflight"));
