import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migrationPath = "supabase/migrations/202608280001_journal_default_selections_v1.sql";
const migration = read(migrationPath);
const legacyMigration = read("supabase/migrations/202608240001_journal_day_default_activities_v1.sql");
const preflight = read("supabase/verification/202608280001_journal_default_selections_v1_preflight.sql");
const postflight = read("supabase/verification/202608280001_journal_default_selections_v1_postflight.sql");
const runtimeQa = read("supabase/verification/202608280001_journal_default_selections_v1_runtime_qa.sql");

describe("Journal Default Selections V1", () => {
  it("uses one transaction and replaces only the canonical compatible registration signature", () => {
    expect(migration.match(/^begin;$/gm)).toHaveLength(1);
    expect(migration.match(/^commit;$/gm)).toHaveLength(1);
    expect(migration).toContain("create or replace function public.register_journal_roster_v2(\n  p_business_date date,\n  p_dog_ids uuid[],\n  p_default_manners_activity text,\n  p_default_physical_activity text,\n  p_expected_defaults_version integer,\n  p_request_id uuid");
    expect(migration).toContain("STOP_JOURNAL_DEFAULT_SELECTIONS_BASELINE_MISSING");
    expect(migration).toContain("STOP_JOURNAL_DEFAULT_SELECTIONS_COLUMN_CONTRACT");
    expect(migration).toContain("STOP_JOURNAL_DEFAULT_SELECTIONS_CREATION_CONTRACT");
  });

  it("initializes every approved selection in the INSERT and preserves version/status table defaults", () => {
    expect(migration).toContain("array['active']::text[],true,true");
    expect(migration).toContain("'good',array['brought_food']::text[],'loves_teacher','loves_friends'");
    expect(migration).toContain("best_friend_dog_id,manners_activity_name,manners_evaluation");
    expect(migration).toContain("physical_activity_name,physical_evaluation,teacher_comment");
    expect(migration).not.toMatch(/insert into public\.journal_entries\([\s\S]*?\bstatus\b/);
    expect(migration).not.toMatch(/insert into public\.journal_entries\([\s\S]*?\bversion\b/);
  });

  it("keeps activity snapshots paired with evaluations and leaves optional domains empty", () => {
    expect(migration).toContain("day_row.default_manners_activity_name");
    expect(migration).toContain("case when day_row.default_manners_activity_name is not null then 'excellent' else null end");
    expect(migration).toContain("day_row.default_physical_activity_name");
    expect(migration).toContain("case when day_row.default_physical_activity_name is not null then 'champion' else null end");
    expect(migration).toContain("null,day_row.default_manners_activity_name");
    expect(migration).toContain("null,actor_id,actor_id");
    expect(migration).not.toContain("insert into public.journal_entry_best_friend_targets");
  });

  it("is create-only and preserves replay, existing-row, audit, and rollback atomicity", () => {
    expect(migration).toContain("on conflict(journal_day_id,dog_id) do nothing returning id into inserted_id");
    expect(migration).toContain("if inserted_id is not null then");
    expect(migration).toContain("return public.get_journal_roster(p_business_date);");
    expect(migration).toContain("journal_day_default_activities_register");
    expect(migration).toContain("'Journal roster Dog added'");
    expect(migration).not.toContain("update public.journal_entries");
    expect(migration).not.toContain("delete from public.journal_entries");
  });

  it("does not change table defaults, triggers, RLS, ACL, or existing business rows", () => {
    expect(migration).not.toMatch(/alter table public\.journal_entries/i);
    expect(migration).not.toMatch(/create\s+(?:constraint\s+)?trigger/i);
    expect(migration).not.toMatch(/create policy|drop policy|enable row level security/i);
    expect(migration).not.toMatch(/\bgrant\b|\brevoke\b/i);
    expect(migration).not.toMatch(/update public\.journal_entries|delete from public\.journal_entries/i);
    expect(migration).not.toMatch(/\bbackfill\b/i);
  });

  it("retains current authorization, dates, PT409, idempotency, and legacy bridge", () => {
    expect(migration).toContain("not public.is_active_operation_member()");
    expect(migration).toContain("p_business_date>(clock_timestamp() at time zone 'Asia/Seoul')::date");
    expect(migration.match(/errcode='PT409'/g)).toHaveLength(2);
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(p_request_id::text,0))");
    expect(migration).toContain("existing_event.after_data->'request' is distinct from request_payload");
    expect(legacyMigration).toContain("return public.register_journal_roster_v2(");
  });

  it("has a stable non-empty migration SHA-256 for the release gate", () => {
    expect(createHash("sha256").update(migration).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ships read-only release gates and rollback-only runtime evidence", () => {
    expect(preflight).toContain("begin read only;");
    expect(preflight).toContain("READY_TO_APPLY_JOURNAL_DEFAULT_SELECTIONS_V1");
    expect(postflight).toContain("begin read only;");
    expect(postflight).toContain("JOURNAL_DEFAULT_SELECTIONS_V1_READY");
    expect(postflight).toContain("array[''active'']::text[],true,true");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_INITIAL_VALUES");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_REPLAY");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_EXISTING_NOOP");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_MIXED_EXISTING_NEW");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_CREATE_AUDIT");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_PARTIAL_STATE");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_DELETE_REREGISTER");
    expect(runtimeQa).toContain("JOURNAL_DEFAULT_SELECTIONS_EMPTY_ACTIVITY_PAIR");
    expect(runtimeQa.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
