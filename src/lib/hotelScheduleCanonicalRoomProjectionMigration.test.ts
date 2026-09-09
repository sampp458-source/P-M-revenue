import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/202609080004_hotel_schedule_canonical_room_projection.sql");
const preflight = read("supabase/verification/202609080004_hotel_schedule_canonical_room_projection_preflight.sql");
const postflight = read("supabase/verification/202609080004_hotel_schedule_canonical_room_projection_postflight.sql");
const runtimeQa = read("supabase/verification/202609080004_hotel_schedule_canonical_room_projection_runtime_qa.sql");
const repository = read("src/pages/operationsScheduleRepository.ts");
const core = (sql: string) => sql.split("  -- BEGIN CANONICAL PROJECTION CORE\n")[1]
  .split("  -- END CANONICAL PROJECTION CORE")[0];

describe("Hotel schedule lifecycle-aware room projection contract", () => {
  it("keeps the one authorized read RPC and changes no applied migration", () => {
    expect(migration.match(/^begin;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration.match(/create function public\./g)).toHaveLength(1);
    for (const part of ["p_operation_schedule_ids uuid[]", "returns jsonb", "stable",
      "security definer", "set search_path = public, pg_temp",
      "auth.uid() is null or not public.is_active_operation_member()",
      "using errcode = '42501'", "from public, anon", "to authenticated, service_role"]) {
      expect(migration).toContain(part);
    }
    expect(migration).not.toMatch(/\b(insert into|update|delete from|truncate|alter table|create table|drop table)\b/i);
    const applied = [
      ["202609080001_hotel_shared_room_member_check_in_reversal", "1f94f86f1d3c45efe76cbbaf6cb3e8f23cad716d850b4ccf28dcd58ffd72b6ed"],
      ["202609080002_hotel_atomic_reverse_check_in_and_unassign", "3af6e94fad98d315c86e364c4c2e0da9bd0bd7d75c8c8e81754e5752f4f413ed"],
      ["202609080003_hotel_staff_operation_capability_parity", "5658b6d29e9e08099bd4003deae549941f6771de4e0a618aebd15899dacf6f64"],
    ];
    for (const [file, hash] of applied) {
      expect(createHash("sha256").update(read(`supabase/migrations/${file}.sql`)).digest("hex")).toBe(hash);
    }
  });

  it("has no literal identity, room name, dog name or timestamp in the runtime predicate", () => {
    const body = migration.split("as $$")[1].split("$$;")[0];
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(body).not.toMatch(/\b(?:19|20|21)\d{2}-\d{2}-\d{2}\b/);
    expect(body).not.toMatch(/\b(?:DELUXE|STANDARD)\b|두부|QA |case.?5|synthetic/i);
    expect(body).not.toMatch(/(?:stay|allocation|room|capacity)\.id\s*=\s*'/i);
    expect(body).not.toMatch(/(?:room|room_type|dog)\.name\s*=\s*'/i);
    expect(body).not.toMatch(/archived_at\s*(?:[<>]=?|between)|(?:least|greatest)\([^)]*archived_at/i);
  });

  it("uses retained Single segments, never archive timestamps or mutable capacity type as historical selection", () => {
    expect(migration).toContain("allocation.archived_at is null as retained");
    expect(migration).toContain("where allocation_candidate.retained");
    expect(migration).toContain("room_type.id = room.room_type_id");
    expect(migration).not.toContain("room.room_type_id = capacity.room_type_id");
    expect(migration).not.toMatch(/(?:least|greatest)\([^)]*archived_at/i);
    expect(migration).not.toContain("public.entity_audit_events");
    expect(migration).not.toMatch(/\blimit\s+1\b/i);
    for (const part of [
      "allocation.allocated_from <= context.event_at",
      "allocation.allocated_until > context.event_at",
      "allocation.allocated_from < context.event_at",
      "allocation.allocated_until >= context.event_at",
      "capacity.reserved_from <= context.event_at",
      "capacity.reserved_until >= context.event_at",
      "when completed_event then 'unavailable'",
      "when single_candidate_count > 1 then 'unavailable'",
      "single_invalid_provenance_count > 0",
    ]) expect(migration).toContain(part);
  });

  it("accepts only direct canonical Long Stay closed inventory evidence", () => {
    for (const part of [
      "capacity.archived_at is not null", "isfinite(allocation.allocated_until)",
      "long_stay_outing_inventory_segment_closed",
      "leave_event.released_allocation_id = allocation.id",
      "leave_event.released_capacity_id = capacity.id",
      "allocation.allocated_until = capacity.reserved_until",
      "allocation.allocated_until >= leave_event.occurred_at",
      "allocation.allocated_until <= leave_event.guarantee_from",
    ]) expect(migration).toContain(part);
  });

  it("does not use a changed Shared room as historical evidence", () => {
    for (const part of [
      "allocation.id = occupancy.room_allocation_id",
      "occupancy.status = 'active'", "physical_member.status = 'active'",
      "context.checked_out_at is null", "allocation.updated_at <= context.event_at",
      "allocation.version = 1", "context.event_at >= statement_timestamp()",
      "when shared_group_count = 1 then 'unavailable'",
      "and not completed_event and checked_out_at is null",
    ]) expect(migration).toContain(part);
  });

  it("preflight runs the identical core and postflight fingerprints that exact core", () => {
    expect(core(preflight)).toBe(core(migration));
    expect(postflight).toContain(createHash("md5").update(core(migration)).digest("hex"));
    expect(postflight).toContain("canonical_core_matches_runtime");
    expect(postflight).toContain("stable_read_only_ok");
    for (const sql of [preflight, postflight]) {
      expect(sql.toLowerCase()).toMatch(/begin(?: transaction read only;|;\s*set transaction read only;)/);
      expect(sql.trimEnd()).toMatch(/rollback;$/i);
      const statements = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/'(?:''|[^'])*'/g, "''");
      expect(statements).not.toMatch(/\b(insert|update|delete|truncate|grant|revoke|alter|create|drop)\b/i);
      expect(sql).toContain("'INFORMATIONAL_ONLY'");
    }
  });

  it("keeps the approved migration immutable and enforces the Family RPC-only security baseline", () => {
    expect(createHash("sha256").update(migration).digest("hex")).toBe(
      "72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c",
    );
    const readContract = read("supabase/migrations/202608060002_family_booking_read_contract.sql");
    for (const table of ["family_booking_members", "family_shared_room_groups"]) {
      expect(readContract).toContain(`revoke select on table public.${table} from authenticated;`);
      expect(preflight).toContain(`('${table}',false,false,true)`);
      expect(preflight).not.toContain(`('${table}',true,false,true)`);
    }
    for (const guard of [
      "c.oid IS NOT NULL AND c.relrowsecurity", "NOT c.relforcerowsecurity",
      "column_acl.attacl IS NOT NULL", "has_table_privilege('authenticated',c.oid,'SELECT')=b.authenticated_select",
      "NOT has_table_privilege('anon'", "NOT has_table_privilege('authenticated'",
      "p.polcmd='r' AND p.polpermissive", "p.polroles=array[",
      "p.polwithcheck IS NULL", "is_active_operation_member()",
      "UNION ALL SELECT * FROM security_checks", "SELECT bool_and(ok) FROM catalog_checks",
    ]) expect(preflight).toContain(guard);
  });

  it("keeps batch UI failure containment and all four labels", () => {
    expect(repository.match(/get_operation_hotel_room_projections/g)).toHaveLength(1);
    expect(repository).toContain("p_operation_schedule_ids: linkedScheduleIds");
    expect(repository).toContain('return "객실 정보 확인 필요"');
    expect(repository).toContain('return `${schedule.hotelRoomTypeName} · 미배정`');
    for (const status of ["resolved", "unassigned", "unknown", "unavailable"])
      expect(migration).toContain(`'${status}'`);
  });

  it("ships executable rollback-only lifecycle fixtures, including CASE 5 shape and 13 archive variants", () => {
    expect(runtimeQa).toContain("select hotel_qa.assert_isolated_environment();");
    expect(runtimeQa.trimEnd()).toMatch(/rollback;$/);
    for (const id of [
      "01_single_current_resolved", "02_single_unassigned",
      "08_single_archived_history_unavailable", "09_retired_capacity_unavailable",
      "14_pre_check_in_type_change", "15_case5_retained_standard_not_revoked_deluxe",
      "16_historical_exact_checkout", "17_checkout_reversal",
      "18_historical_cross_type_ambiguous", "19_historical_archived_only",
      "20_check_in_reversal_unassigned", "21_immediate_reassign_recheck_in",
      "22_shared_moved_historical_unavailable", "23_long_stay_direct_release",
      "24_long_stay_keep_to_release", "25_long_stay_returned_old_segment",
      "26_long_stay_returned_new_segment", "27_shared_completed_event_unchanged",
      "28_shared_same_transaction_move_unavailable",
      "29_shared_current_room_relation_conflict", "30_shared_current_member_relation_missing",
      "31_shared_group_identity_ambiguous",
    ]) expect(runtimeQa).toContain(`'${id}'`);
    expect(runtimeQa).toContain("for n in 1..13 loop");
    expect(runtimeQa).toContain("<> 44");
    expect(runtimeQa).toContain("QA_INACTIVE_ACCEPTED");
    expect(runtimeQa).not.toContain("84b2fb9f-ef81-4177-9e38-9782b3f263df");
  });
  it("keeps Production QA authorization skips separate from resolver failures", () => {
    const sql = read("supabase/verification/202609080004_hotel_schedule_canonical_room_projection_production_read_only_runtime_qa.sql");
    expect(core(sql)).toBe(core(migration));
    expect(sql).toContain("AND a.active_actor AND r.n>0\n      THEN public.get_operation_hotel_room_projections(r.ids)\n      ELSE NULL::jsonb");
    expect(sql).toContain("WHEN NOT a.active_actor THEN 'NOT_EXECUTED_AUTHORIZATION_PRECONDITION'");
    expect(sql).toContain("ELSE 'AUTHORIZATION_PRECONDITION_NOT_MET'");
    expect(sql).toContain("WHEN EXISTS (SELECT 1 FROM checks WHERE status='FAIL') THEN 'FAIL'");
    expect(sql).toContain("RUNTIME_VALIDATION_NOT_EXECUTED_AUTHORIZATION_PRECONDITION");
    expect(sql.trim()).toMatch(/^BEGIN;[\s\S]*ROLLBACK;$/);
  });

});
