import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migrationSha = "497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const clean = (value) => value.replace(/^\\set[^\n]*\n/gm, "");
const write = (path, value) => {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
};
const packageSql = (label, path, guard = "") => {
  const source = read(path);
  return `-- ${label}\n-- Embedded source: ${path}\n-- Embedded source SHA-256: ${sha(source)}\n${guard}${clean(source)}`;
};

write("supabase/qa/journal-editor/journal_editor_dashboard_preflight.sql", packageSql("Clean QA Journal Editor preflight", "supabase/verification/202608150002_journal_v1_editor_preflight.sql"));
write("supabase/qa/journal-editor/journal_editor_dashboard_migration.sql", packageSql("Clean QA Journal Editor migration", "supabase/migrations/202608150002_journal_v1_editor.sql", "select hotel_qa.assert_isolated_environment();\n"));
write("supabase/qa/journal-editor/journal_editor_dashboard_runtime_qa.sql", packageSql("Clean QA Journal Editor A-AA runtime QA", "supabase/verification/202608150002_journal_v1_editor_runtime_qa.sql"));
write("supabase/qa/journal-editor/journal_editor_dashboard_postflight.sql", packageSql("Clean QA Journal Editor postflight", "supabase/verification/202608150002_journal_v1_editor_postflight.sql"));

const productionGuard = `begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','${migrationSha}',true);
do $$ begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '${migrationSha}'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_PRODUCTION_BINDING';
  end if;
end $$;
rollback;
`;
write("supabase/verification/202608150002_journal_v1_editor_dashboard_migration.sql", packageSql("Production Journal Editor migration", "supabase/migrations/202608150002_journal_v1_editor.sql", productionGuard));
