import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const migration = read("supabase/migrations/202608220001_journal_member_delete_contract.sql");
const preflight = read("supabase/verification/202608220001_journal_member_delete_contract_preflight.sql");
const postflight = read("supabase/verification/202608220001_journal_member_delete_contract_postflight.sql");
const rollback = read("supabase/verification/202608220001_journal_member_delete_contract_rollback.sql");
const runtimeQa = read("supabase/verification/202608220001_journal_member_delete_contract_runtime_qa.sql");
const journalHome = read("src/pages/JournalHome.tsx");
const journalEditor = read("src/pages/JournalEditor.tsx");

describe("Journal active member delete contract", () => {
  it("authorizes every active Operations member on the server without an admin branch", () => {
    expect(migration).toContain("actor_id is null or not public.is_active_operation_member()");
    expect(migration).toContain("errcode = '42501'");
    expect(migration).not.toContain("is_admin()");
    expect(migration).not.toMatch(/row_before\.status\s*<>/);
  });

  it("keeps optimistic versioning and target-safe idempotency", () => {
    expect(migration).toContain("row_before.version <> p_expected_version");
    expect(migration).toContain("errcode = 'PT409'");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("audit.request_id = p_request_id");
    expect(migration).toContain("replay_event.entity_id is distinct from p_entry_id");
    expect(migration).toContain("replay_event.after_data -> 'request' is distinct from request_contract");
  });

  it("deletes exactly one entry and preserves every parent and business row", () => {
    expect(migration.match(/delete from public\.journal_entries/g)).toHaveLength(1);
    expect(migration).toContain("get diagnostics deleted_count = row_count");
    expect(migration).toContain("deleted_count <> 1");
    expect(migration).not.toMatch(/delete from public\.(journal_days|dogs|customers|operation_schedules|hotel_stays|sales)/);
    expect(migration).not.toMatch(/drop\s+(table|function|policy|trigger)/i);
  });

  it("records the canonical member delete audit before the exact deletion", () => {
    expect(migration.indexOf("insert into public.entity_audit_events")).toBeLessThan(migration.indexOf("delete from public.journal_entries"));
    expect(migration).toContain("'journal_entry_delete'");
    expect(migration).toContain("'journalDayId', row_before.journal_day_id");
    expect(migration).toContain("'dogId', row_before.dog_id");
    expect(migration).toContain("'statusBeforeDelete', row_before.status");
    expect(migration).toContain("actor_id");
    expect(migration).toContain("p_request_id");
  });

  it("keeps direct table deletion unavailable and pins the RPC surface", () => {
    expect(migration).toContain("revoke all on function public.remove_journal_roster_entry(uuid, integer, uuid) from public, anon");
    expect(migration).toContain("grant execute on function public.remove_journal_roster_entry(uuid, integer, uuid) to authenticated, service_role");
    expect(migration).not.toMatch(/grant\s+delete\s+on/i);
    expect(postflight).toContain("array['authenticated', 'postgres', 'service_role']::text[]");
    expect(postflight).toContain("has_table_privilege('authenticated', 'public.journal_entries', 'DELETE')");
  });

  it("ships guarded verification and restores the original NOT_STARTED-only contract on rollback", () => {
    for (const artifact of [preflight, postflight]) {
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("begin read only;");
    }
    expect(postflight).toContain("JOURNAL_MEMBER_DELETE_CONTRACT_READY");
    expect(rollback).toContain("row_before.status<>'not_started'");
    expect(rollback).not.toContain("journal_entry_delete");
  });

  it("ships rollback-only runtime coverage for member status access, rejects, preservation, and audit", () => {
    expect(runtimeQa).toContain("select hotel_qa.assert_isolated_environment()");
    expect(runtimeQa).toContain("profile.role = 'staff'");
    expect(runtimeQa).toContain("A_MEMBER_DELETE_NOT_STARTED");
    expect(runtimeQa).toContain("D_MEMBER_DELETE_IN_PROGRESS");
    expect(runtimeQa).toContain("E_MEMBER_DELETE_COMPLETED");
    expect(runtimeQa).toContain("G_INACTIVE_MEMBER_REJECT");
    expect(runtimeQa).toContain("H_ANONYMOUS_REJECT");
    expect(runtimeQa).toContain("F_STALE_VERSION_PT409");
    expect(runtimeQa).toContain("C_REQUEST_REUSE_OTHER_ENTRY_REJECT");
    expect(runtimeQa).toContain("J_RECREATE_SAME_DOG_DATE");
    expect(runtimeQa).toContain("K_ADMIN_DELETE_NOT_STARTED");
    expect(runtimeQa).toContain("L_ADMIN_DELETE_IN_PROGRESS");
    expect(runtimeQa).toContain("M_ADMIN_DELETE_COMPLETED");
    expect(runtimeQa).toContain("N_NON_OPERATIONS_MEMBER_REJECT");
    expect(runtimeQa).toContain("O_JOURNAL_DAY_PRESERVED");
    expect(runtimeQa).toContain("P_DOG_CUSTOMER_OTHER_JOURNAL_PRESERVED");
    expect(runtimeQa).toContain("Q_AUDIT_EXACT");
    expect(runtimeQa).toContain("rollback;");
    expect(runtimeQa).toContain("R_QA_RESIDUE_0");
  });

  it("exposes one confirmed destructive flow in both roster and editor without role checks", () => {
    expect(journalHome).toContain("setRemoveTarget(entry)");
    expect(journalHome).toContain("journalDeleteConfirmationDetail(removeTarget.status)");
    expect(journalEditor).toContain('aria-label="일지 삭제"');
    expect(journalEditor).toContain("journalDeleteConfirmationDetail(entry.status)");
    expect(journalEditor).toContain('variant="danger"');
    expect(`${journalHome}\n${journalEditor}`).not.toContain("canAdminDelete");
  });
});
