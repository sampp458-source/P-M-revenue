import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/202609010001_hotel_unassigned_shared_room_backend_append.sql";
const preflightPath =
  "supabase/verification/202609010001_hotel_unassigned_shared_room_backend_append_preflight.sql";
const postflightPath =
  "supabase/verification/202609010001_hotel_unassigned_shared_room_backend_append_postflight.sql";
const runtimeQaPath =
  "supabase/verification/202609010001_hotel_unassigned_shared_room_backend_append_runtime_qa.sql";

const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const postflight = readFileSync(postflightPath, "utf8");
const runtimeQa = readFileSync(runtimeQaPath, "utf8");
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("Hotel unassigned Shared Room backend append", () => {
  it("is one transactional append migration with no historical rewrites", () => {
    expect(migration.match(/^begin;$/gm)).toHaveLength(1);
    expect(migration.match(/^commit;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain(
      "add column shared_room_group_id uuid null",
    );
    expect(migration).toContain("source_kind in ('stay','daycare','shared_group','shared_occupancy')");
    expect(migration).not.toMatch(/drop\s+column/i);
    expect(migration).not.toMatch(/delete\s+from/i);
  });

  it("owns exactly one active quantity-one Capacity per requested group", () => {
    expect(migration).toContain(
      "create unique index hotel_capacity_reservations_shared_group_uidx",
    );
    expect(migration).toContain("source_kind <> 'shared_group' or quantity = 1");
    expect(migration).toContain("active_group_capacity_count <> 1");
    expect(migration).toContain("active_member_capacity_count <> 0");
    expect(migration).toContain("active_occupancy_count <> 0");
    expect(migration).toContain("upper(btrim(room_type.code)) = 'DELUXE'");
    expect(migration).toContain("deferrable initially deferred");
  });

  it("adds a roomless atomic facade without calling the lossy N-Capacity family RPC", () => {
    const facadeStart = migration.indexOf(
      "create function public.create_unassigned_shared_room_family_booking(",
    );
    const facadeEnd = migration.indexOf(
      "comment on function public.create_unassigned_shared_room_family_booking(",
    );
    const facade = migration.slice(facadeStart, facadeEnd);
    expect(facadeStart).toBeGreaterThan(0);
    expect(facade).not.toContain("p_room_id");
    expect(facade).not.toContain("public.create_family_booking(");
    expect(facade).toContain("is_active_operation_member()");
    expect(facade).toContain("member_count < 2");
    expect(facade).toContain("p_shared_room_intent is distinct from true");
    expect(facade).toContain("'shared_group'");
    expect(facade).toContain("occupancy_count <> 0");
    expect(facade).toContain("allocation_count <> 0");
    expect(facade).toContain("'replayed', true");
    expect(facade).toContain("'replayed', false");
  });

  it("keeps the occupancy signature and supports both Capacity ownership paths", () => {
    expect(migration).toContain(
      "create or replace function public.create_shared_hotel_room_occupancy(",
    );
    expect(migration).toContain("requested_capacity_count = 1");
    expect(migration).toContain("requested_capacity_count = 0");
    expect(migration).toContain("source_kind = 'shared_occupancy'");
    expect(migration).toContain("shared_room_group_id = null");
    expect(migration).toContain("physical_occupancy_id = occupancy_id");
    expect(migration).toContain("insert into public.hotel_physical_occupancy_members");
    expect(migration).toContain("insert into public.hotel_room_allocations");
  });

  it("uses the aggregate then type then room lock hierarchy", () => {
    const capacityCheck = migration.slice(
      migration.indexOf("create or replace function public.assert_hotel_capacity_available("),
      migration.indexOf("create function public.assert_requested_shared_room_capacity_internal("),
    );
    expect(capacityCheck.indexOf("hotel-capacity:all")).toBeLessThan(
      capacityCheck.indexOf("'hotel-capacity:'"),
    );
    const occupancy = migration.slice(
      migration.indexOf("create or replace function public.create_shared_hotel_room_occupancy("),
    );
    expect(occupancy.indexOf("hotel-capacity:all")).toBeLessThan(
      occupancy.indexOf("'hotel-capacity:'"),
    );
    expect(occupancy.indexOf("'hotel-capacity:'")).toBeLessThan(
      occupancy.indexOf("'hotel-room:'"),
    );
  });

  it("blocks single-Stay edit/cancel mutation while a group is requested", () => {
    expect(migration).toContain("guard_requested_shared_room_member_mutation");
    expect(migration).toContain("shared_group.status = 'requested'");
    expect(migration).toContain("using errcode = 'PT409'");
    expect(migration).toContain("hotel_stays_requested_shared_room_guard");
    expect(migration).toContain("operation_schedules_requested_shared_room_guard");
    expect(runtimeQa).toContain("single_stay_cancel_guard");
  });

  it("ships read-only gates and rollback-only fault-injection QA", () => {
    expect(preflight).toContain("begin transaction read only;");
    expect(preflight.trimEnd()).toMatch(/rollback;$/);
    expect(postflight).toContain("begin transaction read only;");
    expect(postflight.trimEnd()).toMatch(/rollback;$/);
    expect(runtimeQa).toContain("select hotel_qa.assert_isolated_environment();");
    expect(runtimeQa.trimEnd()).toMatch(/rollback;$/);
    for (const stage of [
      "family", "member", "stay", "schedule", "group", "shared_capacity",
      "occupancy", "occupancy_member", "capacity_transition",
      "allocation_before", "allocation_after", "audit",
    ]) {
      expect(runtimeQa).toContain(`'${stage}'`);
    }
    expect(runtimeQa).toContain("before_counts=after_counts");
  });

  it("preserves all existing public mutation RPC signatures", () => {
    for (const signature of [
      "public.create_family_booking(uuid,text,boolean,jsonb,uuid)",
      "public.create_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,uuid,boolean,uuid)",
      "public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)",
      "public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)",
    ]) {
      expect(postflight).toContain(signature);
    }
  });

  it("preserves recovered historical migrations byte-for-byte", () => {
    expect(sha256("supabase/migrations/202608020002_hotel_operations_workflows.sql"))
      .toBe("1ecd7f927f3404672211d5bab314adb6dca846e874f4b48a284305770b1af178");
    expect(sha256("supabase/migrations/202608110001_multi_dog_shared_room.sql"))
      .toBe("55530b1073de1aeded2242d3c48953e5bb93f05c81ea38a4962d91784e314b3b");
    expect(sha256("supabase/migrations/202608130001_existing_hotel_stays_shared_room_merge.sql"))
      .toBe("4bcf2ab5d023c2513aedeed95b38f1a530d6799292b637daacd496a75b55c3c0");
  });
});
