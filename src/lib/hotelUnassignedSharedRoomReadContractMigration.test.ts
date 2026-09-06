import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/202609010002_hotel_unassigned_shared_room_read_contract.sql";
const preflightPath =
  "supabase/verification/202609010002_hotel_unassigned_shared_room_read_contract_preflight.sql";
const postflightPath =
  "supabase/verification/202609010002_hotel_unassigned_shared_room_read_contract_postflight.sql";
const runtimeQaPath =
  "supabase/verification/202609010002_hotel_unassigned_shared_room_read_contract_runtime_qa.sql";

const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const postflight = readFileSync(postflightPath, "utf8");
const runtimeQa = readFileSync(runtimeQaPath, "utf8");

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("Hotel unassigned Shared Room read contract append", () => {
  it("keeps the approved migration bytes identifiable", () => {
    expect(sha256(migrationPath)).toBe(
      "6758466d221eb4fb5aad2320fb239966c6de3813ddf64439fdda94fe10e125b7",
    );
    expect(preflight).toContain(
      "6758466d221eb4fb5aad2320fb239966c6de3813ddf64439fdda94fe10e125b7",
    );
  });

  it("is one append-only transaction with no business-row mutation", () => {
    expect(migration.match(/^begin;$/gm)).toHaveLength(1);
    expect(migration.match(/^commit;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain(
      "create function public.get_unassigned_shared_hotel_room_groups(p_date date)",
    );
    expect(migration).not.toMatch(/\b(insert into|update|delete from|truncate)\b/i);
    expect(migration).not.toMatch(/\b(alter table|create table|drop table)\b/i);
  });

  it("uses the canonical Operations authorization and least-privilege ACL", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("is_active_operation_member()");
    expect(migration).toContain("using errcode = '42501'");
    expect(migration).toContain(
      "revoke all on function public.get_unassigned_shared_hotel_room_groups(date)",
    );
    expect(migration).toContain("to authenticated, service_role");
    expect(migration).not.toMatch(/grant select on table public\.family_/i);
  });

  it("returns one deterministic projection per requested overlapping group", () => {
    for (const contract of [
      "status = 'requested'",
      "normalized_starts_at < selected_end",
      "normalized_ends_at > selected_start",
      "source_kind = 'shared_group'",
      "capacity.quantity = 1",
      "upper(btrim(room_type.code)) = 'DELUXE'",
      "jsonb_agg(group_projection.value order by",
      "order by member.stable_member_key, member.id",
      "'dogMembers'",
      "'capacityReservationId'",
    ]) {
      expect(migration).toContain(contract);
    }
    expect(migration).toContain("not exists (");
    expect(migration).toContain("public.hotel_physical_occupancies");
  });

  it("ships read-only production gates and rollback-only isolated runtime QA", () => {
    expect(preflight).toContain("begin transaction read only;");
    expect(preflight.trimEnd()).toMatch(/rollback;$/);
    expect(postflight).toContain("begin transaction read only;");
    expect(postflight.trimEnd()).toMatch(/rollback;$/);
    expect(runtimeQa).toContain("select hotel_qa.assert_isolated_environment();");
    expect(runtimeQa.trimEnd()).toMatch(/rollback;$/);
    for (const check of [
      "canonical_empty_response",
      "two_dog_one_projection",
      "three_dog_one_projection",
      "end_boundary_excluded",
      "allocated_group_excluded",
      "archived_group_excluded",
      "unauthorized_user_rejected",
      "authenticated_direct_table_select_revoked",
      "active_member_rpc_success",
    ]) {
      expect(runtimeQa).toContain(`'${check}'`);
    }
  });

  it("keeps postflight business counts informational and gates structural ownership", () => {
    expect(postflight).toContain(
      "'INFORMATIONAL_ONLY'::text as business_count_baseline",
    );
    expect(postflight).not.toMatch(
      /^\s*and (requested_shared_group_count|allocated_shared_group_count|physical_occupancy_count|physical_member_count|requested_shared_capacity_count|allocated_shared_capacity_count)\s*=\s*\d/gm,
    );
    for (const contract of [
      "invalid_requested_capacity_source_count = 0",
      "invalid_allocated_capacity_source_count = 0",
      "duplicate_active_allocated_capacity_count = 0",
      "orphan_allocated_capacity_count = 0",
      "capacity.source_kind in ('shared_group', 'shared_occupancy')",
      "occupancy.room_type_id is distinct from capacity.room_type_id",
      "shared_group.status in ('requested', 'allocated')",
      "invalid_physical_capacity_relation_count = 0",
      "invalid_physical_allocation_relation_count = 0",
      "invalid_allocated_group_status_count = 0",
      "invalid_physical_member_relation_count = 0",
      "structural_invariant_contract",
    ]) {
      expect(postflight).toContain(contract);
    }
  });
});
