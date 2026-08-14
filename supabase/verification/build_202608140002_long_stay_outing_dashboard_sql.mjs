import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migrationSha = "5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6";
const cleanQaRef = "wxbvwixoeczfvbqurdse";
const productionRef = "zorvcuskzemehblqdbfj";
const outputDirectory = resolve(root, "supabase/qa/long-stay-outing");

const phases = [
  ["PREFLIGHT", "supabase/verification/202608140002_long_stay_outing_expected_return_preflight.sql", "long_stay_outing_dashboard_preflight.sql", "begin read only;"],
  ["MIGRATION", "supabase/migrations/202608140002_long_stay_outing_expected_return.sql", "long_stay_outing_dashboard_migration.sql", "begin;"],
  ["RUNTIME_A_M", "supabase/verification/202608140002_long_stay_outing_expected_return_runtime_qa.sql", "long_stay_outing_dashboard_runtime_qa.sql", "begin;"],
  ["POSTFLIGHT_CLEANUP", "supabase/verification/202608140002_long_stay_outing_expected_return_postflight.sql", "long_stay_outing_dashboard_postflight_cleanup.sql", "begin read only;"],
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const binding = `
-- DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','${cleanQaRef}',true);
select set_config('app.release_migration_sha256','${migrationSha}',true);

do $clean_qa_dashboard_binding$
declare guard hotel_qa.environment_guard%rowtype;
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from '${cleanQaRef}'
    or current_setting('app.release_project_ref',true)='${productionRef}'
    or current_setting('app.release_migration_sha256',true) is distinct from '${migrationSha}' then
    raise exception 'STOP_LONG_STAY_OUTING_CLEAN_QA_DASHBOARD_BINDING';
  end if;
  select * into guard from hotel_qa.environment_guard;
  if not found
    or guard.qa_project_ref<>'${cleanQaRef}'
    or guard.production_project_ref<>'${productionRef}'
    or guard.qa_project_ref=guard.production_project_ref then
    raise exception 'STOP_LONG_STAY_OUTING_CLEAN_QA_ENVIRONMENT';
  end if;
  perform hotel_qa.assert_isolated_environment();
end;
$clean_qa_dashboard_binding$;
-- DASHBOARD_BINDING_END
`;

mkdirSync(outputDirectory, { recursive: true });
for (const [phase, sourcePath, outputName, transactionStart] of phases) {
  const source = readFileSync(resolve(root, sourcePath), "utf8");
  if (sourcePath.includes("migrations/") && sha256(source) !== migrationSha) {
    throw new Error("Approved Long Stay outing migration SHA mismatch");
  }
  const dashboardSource = source.replace(/^\\set ON_ERROR_STOP on\n/m, "");
  const metaCommandCount = (source.match(/^\\set ON_ERROR_STOP on$/gm) ?? []).length;
  if ((sourcePath.includes("migrations/") ? metaCommandCount !== 0 : metaCommandCount !== 1)) {
    throw new Error(`${phase} psql meta-command contract is not exact`);
  }
  const occurrenceCount = dashboardSource.split(transactionStart).length - 1;
  if (occurrenceCount !== 1) throw new Error(`${phase} transaction boundary is not exact`);
  const wrapped = dashboardSource.replace(transactionStart, `${transactionStart}${binding}`);
  const header = [
    "-- GENERATED FILE: do not edit or assemble by hand.",
    `-- Dashboard phase: ${phase}`,
    `-- Clean QA exact project: ${cleanQaRef}`,
    `-- Production project ${productionRef} is rejected before any mutation.`,
    `-- Approved migration SHA-256: ${migrationSha}`,
    `-- Embedded source SHA-256: ${sha256(source)}`,
    "",
  ].join("\n");
  writeFileSync(resolve(outputDirectory, outputName), `${header}${wrapped}`);
}
