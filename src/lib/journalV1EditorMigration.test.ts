import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const migration = read("supabase/migrations/202608150002_journal_v1_editor.sql");
const preflight = read("supabase/verification/202608150002_journal_v1_editor_preflight.sql");
const runtime = read("supabase/verification/202608150002_journal_v1_editor_runtime_qa.sql");
const postflight = read("supabase/verification/202608150002_journal_v1_editor_postflight.sql");
const productionPreflight = read("supabase/verification/202608150002_journal_v1_editor_production_preflight.sql");
const productionPostflight = read("supabase/verification/202608150002_journal_v1_editor_production_postflight.sql");
const productionMigration = read("supabase/verification/202608150002_journal_v1_editor_dashboard_migration.sql");

describe("Journal V1 editor migration", () => {
  it("extends the typed Phase 1 entry instead of creating a blob or duplicate identity", () => {
    expect(migration).toContain("alter table public.journal_entries");
    expect(migration).toContain("journal_entries_teacher_comment_length");
    expect(migration).not.toContain("create table public.journal_entries");
    expect(migration).not.toContain("journal_payload");
  });

  it("provides optimistic, replay-safe draft and completion RPCs", () => {
    expect(migration).toContain("create function public.update_journal_entry_draft");
    expect(migration).toContain("create function public.complete_journal_entry");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("using errcode='PT409'");
    expect(migration).toContain("Journal completed entry updated");
    expect(migration).toContain("status=case when status='not_started' then 'in_progress'");
  });

  it("enforces completion, same-roster friendship, and the 500 character contract", () => {
    expect(migration).toContain("validate_journal_entry_completion_internal");
    expect(migration).toContain("같은 날 등원 명단의 반려견만 선택할 수 있습니다.");
    expect(migration).toContain("char_length(coalesce(normalized_comment,''))>500");
    expect(migration).toContain("활동명과 평가는 함께 입력해 주세요.");
  });

  it("preserves member-only RPC and direct-table contracts", () => {
    expect(migration).toContain("public.is_active_operation_member()");
    expect(migration).toContain("grant execute on function %s to authenticated,service_role");
    expect(migration).not.toContain("grant update on table public.journal_entries");
  });

  it("ships fail-closed preflight, A-AA rollback QA, and postflight", () => {
    expect(preflight).toContain("READY_TO_APPLY_JOURNAL_V1_EDITOR");
    expect(preflight).toContain("hotel_qa.assert_isolated_environment()");
    for (const scenario of [
      "A_NOT_STARTED_LOAD", "B_FIRST_MUTATION_IN_PROGRESS", "E_DEFECATION_NO_STOOL_NULL",
      "J_SAME_ROSTER_BEST_FRIEND", "K_SELF_BEST_FRIEND_REJECT", "L_NON_ROSTER_BEST_FRIEND_REJECT",
      "Q_STALE_VERSION_PT409", "R_REPLAY_IDEMPOTENT", "S_INCOMPLETE_COMPLETION_REJECT",
      "T_VALID_COMPLETION", "W_COMPLETED_VALID_EDIT", "Y_ACTIVE_MEMBER_PERMISSION",
      "Z_AUDIT", "AA_QA_RESIDUE_0",
    ]) expect(runtime).toContain(scenario);
    expect(runtime).toContain("rollback;");
    expect(postflight).toContain("JOURNAL_V1_EDITOR_READY");
  });

  it("hard-binds Production and embeds the approved migration body unchanged", () => {
    for (const artifact of [productionPreflight, productionPostflight, productionMigration]) {
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1");
    }
    expect(productionPreflight).toContain("READY_TO_APPLY_JOURNAL_V1_EDITOR");
    expect(productionPostflight).toContain("JOURNAL_V1_EDITOR_READY");
    expect(productionPreflight).toContain("to_regclass('public.hotel_physical_occupancies')");
    expect(productionPostflight).toContain("to_regclass('public.hotel_physical_occupancies')");
    expect(productionPreflight).not.toContain("to_regclass('public.shared_hotel_occupancies')");
    expect(productionPostflight).not.toContain("to_regclass('public.shared_hotel_occupancies')");
    expect(productionMigration.endsWith(migration)).toBe(true);
  });
});
