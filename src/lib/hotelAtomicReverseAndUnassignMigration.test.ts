import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/202609080002_hotel_atomic_reverse_check_in_and_unassign.sql",
);
const verificationPath = (name: string) => resolve(
  import.meta.dirname,
  `../../supabase/verification/202609080002_hotel_atomic_reverse_check_in_and_unassign_${name}.sql`,
);
const source = (path: string) => readFileSync(path, "utf8");
const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

describe("Hotel atomic reverse-check-in and unassign migration", () => {
  const migration = normalized(source(migrationPath));

  it("is one append-only transaction and preserves all existing RPC definitions", () => {
    expect(migration.match(/\bbegin;/g) ?? []).toHaveLength(1);
    expect(migration.match(/\bcommit;/g) ?? []).toHaveLength(1);
    expect(migration).toContain("create function public.reverse_check_in_and_unassign_hotel_room(");
    expect(migration).toContain("create function public.reverse_check_in_and_unassign_shared_hotel_room(");
    expect(migration).not.toContain("create or replace function");
    expect(migration).not.toMatch(/create function public\.(?:reverse_hotel_completion|unassign_hotel_room_before_check_in|reverse_shared_hotel_member_check_in|unassign_shared_hotel_room_before_check_in)\(/);
    expect(migration).not.toContain("alter table public.hotel_physical_occupancy_requests");
  });

  it("composes each user intent inside one database transaction", () => {
    const singleStart = migration.indexOf("create function public.reverse_check_in_and_unassign_hotel_room(");
    const sharedStart = migration.indexOf("create function public.reverse_check_in_and_unassign_shared_hotel_room(");
    const single = migration.slice(singleStart, sharedStart);
    const shared = migration.slice(sharedStart);

    expect(single).toContain("public.reverse_hotel_completion(");
    expect(single).toContain("'check_in'");
    expect(single).toContain("public.unassign_hotel_room_before_check_in(");
    expect(single).toContain("(reverse_result ->> 'version')::integer");
    expect(shared).toContain("public.reverse_shared_hotel_member_check_in(");
    expect(shared).toContain("public.unassign_shared_hotel_room_before_check_in(");
    expect(shared).toContain("current_occupancy_version := (reverse_result -> 'occupancy' ->> 'version')::integer");
    expect(shared).toContain("order by stay.id");
  });

  it("fails closed for checkout, stale versions, missing allocations and invalid members", () => {
    expect(migration).toContain("stay.version <> p_expected_version");
    expect(migration).toContain("stay.checked_in_at is null");
    expect(migration).toContain("stay.checked_out_at is not null");
    expect(migration).toContain("allocation_count <> 1");
    expect(migration).toContain("occupancy.version <> p_expected_version");
    expect(migration).toContain("active_member_count < 2 or checked_in_count < 1");
    expect(migration).toContain("stay.checked_out_at is null");
    expect(migration.match(/where target\.id = p_(?:hotel_stay|occupancy)_id for update/g) ?? []).toHaveLength(2);
    expect(migration).toContain("using errcode = 'pt409'");
  });

  it("uses one facade request ledger with exact-payload replay and deterministic child IDs", () => {
    expect(migration).toContain("create table public.hotel_atomic_reverse_unassign_requests");
    expect(migration).toContain("request_payload is distinct from payload");
    expect(migration).toContain("return existing_request.response_payload");
    expect(migration).toContain("hotel_atomic_child_request_id_internal(p_request_id");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).not.toContain("insert into public.hotel_physical_occupancy_requests");
  });

  it("keeps authorization, SECURITY DEFINER, ACL and no-delete contracts", () => {
    expect(migration.match(/has_operation_role\(array\['owner','manager'\]\)/g) ?? []).toHaveLength(2);
    expect(migration.match(/security definer set search_path = public, pg_temp/g) ?? []).toHaveLength(2);
    expect(migration).toContain("grant execute on function public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid) to authenticated, service_role");
    expect(migration).toContain("grant execute on function public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid) to authenticated, service_role");
    expect(migration).not.toContain("delete from public.");
  });
});

describe("Hotel atomic reverse-and-unassign verification artifacts", () => {
  const extractSingleAllocationDefinition = (artifact: string) => {
    const match = normalized(artifact).match(
      /\(select count\(\*\) from public\.hotel_room_allocations allocation[\s\S]*?\) as invalid_active_single_allocation_count/,
    );
    expect(match).not.toBeNull();
    return match?.[0];
  };

  it.each(["preflight", "postflight"])("keeps %s read-only and rollback bounded", (name) => {
    const artifact = normalized(source(verificationPath(name)));
    expect(artifact).toMatch(/^-- .* begin transaction read only;/);
    expect(artifact.endsWith("rollback;")).toBe(true);
    expect(artifact).not.toMatch(/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b\s+(?:table|function|index|into|public\.)/);
  });

  it("checks semantic function, ACL and data invariants without fixed business counts", () => {
    const postflight = normalized(source(verificationPath("postflight")));
    expect(postflight).toContain("single_atomic_contract_ok");
    expect(postflight).toContain("shared_atomic_contract_ok");
    expect(postflight).toContain("request_ledger_acl_ok");
    expect(postflight).toContain("invalid_shared_allocation_count = 0");
    expect(postflight).toContain("invalid_shared_member_count = 0");
    expect(postflight).toContain("'informational_only'::text as business_counts");
    for (const fixedBusinessCount of [
      "single_stay_count =",
      "shared_occupancy_count =",
      "shared_member_count =",
      "active_allocation_count =",
      "active_capacity_count =",
    ]) {
      expect(postflight).not.toMatch(
        new RegExp(`(?:^|[^a-z0-9_])${fixedBusinessCount.replace(" =", "\\s*=")}`),
      );
    }
  });

  it("uses one lifecycle-aware Single allocation definition in preflight and postflight", () => {
    const preflight = source(verificationPath("preflight"));
    const postflight = source(verificationPath("postflight"));
    const definition = extractSingleAllocationDefinition(preflight);

    expect(definition).toBe(extractSingleAllocationDefinition(postflight));
    expect(definition).toContain("capacity.source_kind = 'stay'");
    expect(definition).toContain("allocation.allocated_from <= transaction_timestamp()");
    expect(definition).toContain("allocation.allocated_until > transaction_timestamp()");
    expect(definition).toContain("public.long_stay_absence_events leave_event");
    expect(definition).toContain("leave_event.inventory_mode = 'release_room'");
    expect(definition).toContain("leave_event.inventory_transition_status in ('room_released', 'room_returned')");
    expect(definition).toContain("leave_event.released_allocation_id = allocation.id");
    expect(definition).toContain("leave_event.released_capacity_id = capacity.id");
    expect(definition).toContain("leave_event.occurred_at <= allocation.allocated_until");
    expect(definition).toContain("allocation.allocated_until <= leave_event.guarantee_from");
    expect(definition).toContain("allocation.allocated_until = capacity.reserved_until");
    expect(definition).toContain("allocation.allocated_until <> 'infinity'::timestamptz");
    expect(definition).toContain("capacity.archive_reason = 'long_stay_outing_inventory_segment_closed'");
    expect(definition).toContain("return_capacity.hotel_stay_id = capacity.hotel_stay_id");
    expect(definition).toContain("return_capacity.room_type_id = capacity.room_type_id");
    expect(definition).toContain("return_capacity.quantity = 1");
  });

  it("ships an isolated rollback-only runtime QA contract", () => {
    const runtime = normalized(source(verificationPath("runtime_qa")));
    expect(runtime).toContain("select hotel_qa.assert_isolated_environment()");
    expect(runtime).toContain("reverse_check_in_and_unassign_hotel_room(");
    expect(runtime).toContain("reverse_check_in_and_unassign_shared_hotel_room(");
    expect(runtime).toContain("partial_shared_checkin");
    expect(runtime).toContain("full_shared_checkin");
    expect(runtime).toContain("checked_out_guard");
    expect(runtime).toContain("same_request_replay");
    expect(runtime).toContain("request_payload_conflict");
    for (const fixture of [
      "single_lifecycle_pre_check_in_active",
      "single_lifecycle_checked_in_active",
      "single_lifecycle_direct_release_history",
      "single_lifecycle_keep_to_release_history",
      "single_lifecycle_room_returned_history",
      "single_lifecycle_archived_capacity_without_provenance",
      "single_lifecycle_open_allocation_with_archived_capacity",
      "single_lifecycle_released_allocation_mismatch",
      "single_lifecycle_released_capacity_mismatch",
      "single_lifecycle_archive_reason_mismatch",
      "single_lifecycle_end_time_mismatch",
      "single_lifecycle_before_occurred_at",
      "single_lifecycle_after_guarantee_from",
      "single_lifecycle_invalid_return_capacity",
    ]) {
      expect(runtime).toContain(fixture);
    }
    expect(runtime).toContain("source_kind = 'shared_group'");
    expect(runtime).toContain("physical_occupancy_id is null");
    expect(runtime).toContain("and (select archived_at is null and source_kind = 'shared_group' and physical_occupancy_id is null and shared_room_group_id = group_id and quantity = 1 from public.hotel_capacity_reservations where id = capacity_id)");
    expect(runtime).not.toContain("and (select archived_at is not null from public.hotel_capacity_reservations where id = capacity_id)");
    expect(runtime.endsWith("rollback;")).toBe(true);
  });
});

describe("Hotel atomic reverse-and-unassign frontend integration", () => {
  it("routes checked-in Single and Shared intents through one facade call", () => {
    const operations = source(resolve(import.meta.dirname, "../pages/HotelOperations.tsx"));
    const sharedRepository = source(resolve(import.meta.dirname, "../platform/multiDogSharedRoomRepository.ts"));
    expect(operations).toContain("reverseCheckInAndUnassignHotelRoom");
    expect(operations).toContain("sharedHotelRoomRepository.reverseCheckInAndUnassign");
    expect(sharedRepository).toContain('"reverse_check_in_and_unassign_shared_hotel_room"');
    expect(operations).not.toMatch(/await\s+reverseHotelCheckIn[\s\S]{0,500}await\s+unassignHotelRoomBeforeCheckIn/);
  });
});
