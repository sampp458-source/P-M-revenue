import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const migration = read("supabase/migrations/202608240001_journal_day_default_activities_v1.sql");
const preflight = read("supabase/verification/202608240001_journal_day_default_activities_v1_preflight.sql");
const postflight = read("supabase/verification/202608240001_journal_day_default_activities_v1_postflight.sql");
const runtimeQa = read("supabase/verification/202608240001_journal_day_default_activities_v1_runtime_qa.sql");
const repository = read("src/pages/journalRepository.ts");
const home = read("src/pages/JournalHome.tsx");

describe("Journal day default activities V1", () => {
  it("adds nullable selected-day defaults with the individual 80 character contract", () => {
    expect(migration).toContain("add column default_manners_activity_name text null");
    expect(migration).toContain("add column default_physical_activity_name text null");
    expect(migration).toContain("add column default_activities_version integer not null default 1");
    expect(migration.match(/char_length\(default_(manners|physical)_activity_name\) <= 80/g)).toHaveLength(2);
    expect(migration).not.toMatch(/update public\.journal_entries/);
  });

  it("normalizes optional free text and exposes defaults through the canonical roster", () => {
    expect(migration.match(/nullif\(btrim\(coalesce\(p_default_(manners|physical)_activity,''\)\),''\)/g)).toHaveLength(4);
    expect(migration).toContain("'defaults',jsonb_build_object(");
    expect(migration).toContain("'mannersActivityName',(select default_manners_activity_name from target_day)");
    expect(migration).toContain("'physicalActivityName',(select default_physical_activity_name from target_day)");
  });

  it("atomically locks the day and snapshots one consistent pair into new entries only", () => {
    expect(migration).toContain("create function public.register_journal_roster_v2");
    expect(migration).toContain("from public.journal_days\n    where business_date=p_business_date and journal_type='daycare_daily'\n    for update");
    expect(migration).toContain("physical_activity_name,created_by,updated_by");
    expect(migration).toContain("day_row.default_manners_activity_name");
    expect(migration).toContain("day_row.default_physical_activity_name");
    expect(migration).toContain("on conflict(journal_day_id,dog_id) do nothing");
    expect(migration).not.toContain("apply_to_not_started");
  });

  it("keeps active-member server authorization, optimistic versioning, and request replay", () => {
    expect((migration.match(/not public\.is_active_operation_member\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((migration.match(/errcode='PT409'/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(migration.match(/pg_advisory_xact_lock\(hashtextextended\(p_request_id::text,0\)\)/g)).toHaveLength(2);
    expect(migration).toContain("journal_day_default_activities_register");
    expect(migration).toContain("journal_day_default_activities_update");
    expect(migration).toContain("from public,anon");
    expect(migration).toContain("to authenticated,service_role");
  });

  it("preserves the original roster RPC while routing legacy callers through current defaults", () => {
    expect(migration).toContain("create or replace function public.register_journal_roster(");
    expect(migration).toContain("return public.register_journal_roster_v2(");
    expect(repository).toContain('rpc<JournalRoster>("register_journal_roster_v2"');
    expect(repository).toContain('rpc<JournalRoster>("update_journal_day_default_activities"');
  });

  it("provides fail-closed preflight, postflight, and rollback-only runtime evidence", () => {
    expect(preflight).toContain("begin read only;");
    expect(preflight).toContain("READY_TO_APPLY_JOURNAL_DAY_DEFAULT_ACTIVITIES_V1");
    expect(postflight).toContain("begin read only;");
    expect(postflight).toContain("JOURNAL_DAY_DEFAULT_ACTIVITIES_V1_READY");
    expect(postflight).toContain("has_table_privilege('authenticated','public.journal_days','INSERT,UPDATE,DELETE')");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_INITIAL_SNAPSHOT");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_OVERRIDE_ISOLATION");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_NO_PROPAGATION");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_FUTURE_ENTRY");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_DELETE_RECREATE");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_ONE_EMPTY_PHYSICAL");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_ONE_EMPTY_MANNERS");
    expect(runtimeQa).toContain("JOURNAL_DAY_DEFAULT_BOTH_EMPTY_NORMALIZATION");
    expect(runtimeQa.trimEnd().endsWith("rollback;")).toBe(true);
  });

  it("renders Dog-first registration with compact mobile defaults and a separate defaults-only action", () => {
    expect(home).toContain("오늘의 공통 활동");
    expect(home).toContain('placeholder="예절교육 활동명 입력"');
    expect(home).toContain('placeholder="체육활동 활동명 입력"');
    expect(home).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2");
    expect(home.indexOf('label="반려견 선택"')).toBeLessThan(home.indexOf("오늘의 공통 활동"));
    expect(home).toContain("maxLength={80}");
    expect(home).toContain("공통 활동만 저장");
  });
});
