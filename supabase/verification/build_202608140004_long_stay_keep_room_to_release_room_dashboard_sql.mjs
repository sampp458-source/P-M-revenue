import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const productionRef = "zorvcuskzemehblqdbfj";
const cleanQaRef = "wxbvwixoeczfvbqurdse";
const migrationPath = "supabase/migrations/202608140004_long_stay_keep_room_to_release_room_transition.sql";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const migrationSha = sha256(readFileSync(resolve(root, migrationPath), "utf8"));

const binding = (target) => target === "clean-qa" ? `
-- CLEAN_QA_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','${cleanQaRef}',true);
select set_config('app.release_migration_sha256','${migrationSha}',true);
do $dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from '${cleanQaRef}'
    or current_setting('app.release_project_ref',true)='${productionRef}'
    or current_setting('app.release_migration_sha256',true) is distinct from '${migrationSha}'
    or to_regprocedure('hotel_qa.assert_isolated_environment()') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_CLEAN_QA_DASHBOARD_BINDING';
  end if;
  perform hotel_qa.assert_isolated_environment();
end;
$dashboard_binding$;
-- CLEAN_QA_DASHBOARD_BINDING_END
` : `
-- PRODUCTION_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','${productionRef}',true);
select set_config('app.release_migration_sha256','${migrationSha}',true);
do $dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from '${productionRef}'
    or current_setting('app.release_project_ref',true)='${cleanQaRef}'
    or current_setting('app.release_migration_sha256',true) is distinct from '${migrationSha}'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_PRODUCTION_DASHBOARD_BINDING';
  end if;
end;
$dashboard_binding$;
-- PRODUCTION_DASHBOARD_BINDING_END
`;

const phases = [
  ["preflight", "supabase/verification/202608140004_long_stay_keep_room_to_release_room_transition_preflight.sql", "begin read only;"],
  ["migration", migrationPath, "begin;"],
  ["runtime_qa", "supabase/verification/202608140004_long_stay_keep_room_to_release_room_transition_runtime_qa.sql", "begin;"],
  ["postflight", "supabase/verification/202608140004_long_stay_keep_room_to_release_room_transition_postflight.sql", "begin read only;"],
];

for (const target of ["clean-qa", "production"]) {
  const outputDirectory = resolve(root, `supabase/qa/long-stay-keep-to-release-${target}`);
  mkdirSync(outputDirectory, { recursive: true });
  for (const [phase, sourcePath, transactionStart] of phases) {
    if (target === "production" && phase === "runtime_qa") continue;
    const source = readFileSync(resolve(root, sourcePath), "utf8");
    let body = source.replace(/^\\set ON_ERROR_STOP on\n/m, "");
    if (target === "production") {
      body = body
        .replace(/^-- CLEAN QA ONLY\. Read-only (preflight|postflight)\.\n/m, "")
        .replace(/^select hotel_qa\.assert_isolated_environment\(\);\n/m, "");
      if (body.includes("hotel_qa.assert_isolated_environment")) {
        throw new Error(`${phase} retained a Clean QA-only assertion`);
      }
    }
    const count = body.split(transactionStart).length - 1;
    if (count !== 1) throw new Error(`${target}/${phase} transaction boundary is not exact`);
    body = body.replace(transactionStart, `${transactionStart}${binding(target)}`);
    const header = [
      "-- GENERATED FILE: do not edit or assemble by hand.",
      `-- Dashboard target: ${target}`,
      `-- Dashboard phase: ${phase.toUpperCase()}`,
      `-- Production ref: ${productionRef}`,
      `-- Clean QA ref: ${cleanQaRef}`,
      `-- Approved migration SHA-256: ${migrationSha}`,
      `-- Embedded source SHA-256: ${sha256(source)}`,
      "",
    ].join("\n");
    writeFileSync(resolve(outputDirectory, `long_stay_keep_to_release_dashboard_${phase}.sql`), `${header}${body}`);
  }
}
