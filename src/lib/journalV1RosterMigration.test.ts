import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/202608150001_journal_v1_roster.sql"), "utf8");
const preflight = readFileSync(resolve(import.meta.dirname, "../../supabase/verification/202608150001_journal_v1_roster_preflight.sql"), "utf8");
const runtime = readFileSync(resolve(import.meta.dirname, "../../supabase/verification/202608150001_journal_v1_roster_runtime_qa.sql"), "utf8");
const postflight = readFileSync(resolve(import.meta.dirname, "../../supabase/verification/202608150001_journal_v1_roster_postflight.sql"), "utf8");
const productionPreflight = readFileSync(resolve(import.meta.dirname, "../../supabase/verification/202608150001_journal_v1_roster_production_preflight.sql"), "utf8");
const productionPostflight = readFileSync(resolve(import.meta.dirname, "../../supabase/verification/202608150001_journal_v1_roster_production_postflight.sql"), "utf8");

describe("Journal V1 roster migration", () => {
  it("uses one daily root and one canonical entry per Dog", () => {
    expect(migration).toContain("create table public.journal_days");
    expect(migration).toContain("create table public.journal_entries");
    expect(migration).toContain("unique (business_date, journal_type)");
    expect(migration).toContain("unique (journal_day_id, dog_id)");
    expect(migration).toContain("references public.dogs(id) on delete restrict");
    expect(migration).toContain("references public.customers(id) on delete restrict");
  });

  it("preserves typed future editor fields without a JSONB data blob", () => {
    for (const fragment of [
      "condition_codes text[]", "urination boolean", "defecation boolean",
      "stool_condition text", "meal_codes text[]", "teacher_relationship text",
      "friend_relationship text", "best_friend_dog_id uuid",
      "manners_activity_name text", "manners_evaluation text",
      "physical_activity_name text", "physical_evaluation text", "teacher_comment text",
    ]) expect(migration).toContain(fragment);
    expect(migration).not.toContain("journal_payload jsonb");
  });

  it("supports optimistic status changes and fail-closed removal", () => {
    expect(migration).toContain("status in ('not_started','in_progress','completed')");
    expect(migration).toContain("row_before.version<>p_expected_version");
    expect(migration).toContain("using errcode='PT409'");
    expect(migration).toContain("if row_before.status<>'not_started'");
    expect(migration).toContain("작성중이거나 완료된 일지는 명단에서 제거할 수 없습니다.");
  });

  it("reuses Operations membership, audit, RLS, and exact RPC ACL contracts", () => {
    expect(migration).toContain("public.is_active_operation_member()");
    expect(migration).toContain("insert into public.entity_audit_events");
    expect(migration).toContain("alter table public.journal_days enable row level security");
    expect(migration).toContain("alter table public.journal_entries enable row level security");
    expect(migration).toContain("revoke all on table public.journal_days,public.journal_entries from public,anon,authenticated,service_role");
    expect(migration).toContain("grant execute on function %s to authenticated,service_role");
  });

  it("rejects future rosters and validates every Dog/customer ownership pair", () => {
    expect(migration).toContain("p_business_date>(clock_timestamp() at time zone 'Asia/Seoul')::date");
    expect(migration).toContain("join public.customers customer on customer.id=dog.customer_id");
    expect(migration).toContain("dog.is_active and customer.is_active");
  });

  it("ships fail-closed Clean QA preflight, A-P rollback QA, and postflight", () => {
    expect(preflight).toContain("select hotel_qa.assert_isolated_environment()");
    expect(preflight).toContain("READY_TO_APPLY_JOURNAL_V1_ROSTER");
    expect(runtime).toContain("begin;");
    expect(runtime).toContain("rollback;");
    for (const scenario of [
      "A_JOURNAL_DATE_CREATE", "B_REGISTER_3_DOGS", "C_DUPLICATE_0",
      "F_IN_PROGRESS_SUMMARY", "G_COMPLETED_SUMMARY", "H_REMOVE_NOT_STARTED",
      "I_REMOVE_IN_PROGRESS_REJECT", "J_REMOVE_COMPLETED_REJECT",
      "K_SAME_DATE_UNIQUE", "L_PAST_DATE_READ", "M_PERMISSION",
      "N_STALE_VERSION_PT409", "O_AUDIT", "P_QA_RESIDUE_0",
    ]) expect(runtime).toContain(scenario);
    expect(postflight).toContain("JOURNAL_V1_ROSTER_READY");
    expect(postflight).toContain("STOP_JOURNAL_RPC_ACL_CONTRACT");
  });

  it("hard-binds production verification while explicitly rejecting Clean QA", () => {
    for (const artifact of [productionPreflight, productionPostflight]) {
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("7af383b7beb9da15addaf5a45eabd544df3494fac184180e256d4c0c3e4f07b9");
      expect(artifact).toContain("begin read only");
      expect(artifact).toContain("to_regclass('hotel_qa.environment_guard') is not null");
    }
    expect(productionPreflight).toContain("READY_TO_APPLY_JOURNAL_V1_ROSTER");
    expect(productionPostflight).toContain("JOURNAL_V1_ROSTER_READY");
  });
});
