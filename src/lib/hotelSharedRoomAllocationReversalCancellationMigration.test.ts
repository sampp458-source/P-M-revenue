import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/202609060001_hotel_shared_room_allocation_reversal_and_cancellation.sql",
);
const verificationPath = (name: string) => resolve(
  import.meta.dirname,
  `../../supabase/verification/202609060001_hotel_shared_room_allocation_reversal_and_cancellation_${name}.sql`,
);
const source = (path: string) => readFileSync(path, "utf8");
const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const extractLifecyclePairs = (artifact: string) => {
  const compact = normalized(artifact);
  const match = compact.match(
    /\(occupancy\.status, room_group\.status\) not in \( \('([^']+)', '([^']+)'\), \('([^']+)', '([^']+)'\) \)/,
  );
  if (!match) {
    throw new Error("Shared Room lifecycle matrix is missing");
  }
  return new Set([`${match[1]}:${match[2]}`, `${match[3]}:${match[4]}`]);
};

const extractLifecycleCountDefinition = (artifact: string) => {
  const compact = normalized(artifact);
  const start = compact.indexOf(
    "(select count(*) from public.hotel_physical_occupancies occupancy left join public.family_shared_room_groups room_group",
  );
  const marker = ") as invalid_occupancy_group_lifecycle_count";
  const end = compact.indexOf(marker, start);
  if (start < 0 || end < 0) {
    throw new Error("Shared Room lifecycle count definition is missing");
  }
  return compact.slice(start, end + marker.length);
};

const isCanonicalLifecycle = (
  pairs: Set<string>,
  occupancyStatus: string,
  groupStatus: string,
) => pairs.has(`${occupancyStatus}:${groupStatus}`);

type LifecycleGroup = { id: string; status: string; archived?: boolean };
type LifecycleOccupancy = { groupId: string; status: string; archived?: boolean };

const validateLifecycleFixture = (
  pairs: Set<string>,
  groups: LifecycleGroup[],
  occupancies: LifecycleOccupancy[],
) => {
  const activeGroups = new Map(groups.filter((group) => !group.archived).map((group) => [group.id, group]));
  const currentOccupancies = occupancies.filter((occupancy) => !occupancy.archived);
  const invalidLifecycle = currentOccupancies.some((occupancy) => {
    const group = activeGroups.get(occupancy.groupId);
    return !group || !isCanonicalLifecycle(pairs, occupancy.status, group.status);
  });
  const allocatedWithoutCurrentOccupancy = [...activeGroups.values()].some(
    (group) => group.status === "allocated"
      && !currentOccupancies.some(
        (occupancy) => occupancy.groupId === group.id && occupancy.status === "active",
      ),
  );
  return !invalidLifecycle && !allocatedWithoutCurrentOccupancy;
};

describe("Shared Room allocation reversal and cancellation migration", () => {
  const migration = source(migrationPath);
  const sql = normalized(migration);

  it("is one append-only transaction with the approved two new RPCs", () => {
    expect((sql.match(/\bbegin;/g) ?? [])).toHaveLength(1);
    expect((sql.match(/\bcommit;/g) ?? [])).toHaveLength(1);
    expect(sql).toContain("create function public.unassign_shared_hotel_room_before_check_in(");
    expect(sql).toContain("create function public.cancel_shared_hotel_room_family_booking(");
    expect(sql).not.toContain("create or replace function");
    expect(sql.match(/create function public\./g) ?? []).toHaveLength(2);
    expect(sql).not.toMatch(/create function public\.(?:create_shared_hotel_room_occupancy|move_shared_hotel_room_occupancy|create_unassigned_shared_room_family_booking|create_flexible_hotel_reservation)\(/);
    expect(sql).not.toMatch(/\b(insert|delete)\s+into?\s+public\./);
  });

  it("fails closed on the exact old request ledger contract and appends only two operation kinds", () => {
    expect(sql).toContain("stop_shared_room_reversal_unexpected_request_operation_kinds");
    ["'check_in'", "'check_out'", "'create'", "'join'", "'merge_existing_stays'", "'move'", "'reverse_completion'"]
      .forEach((kind) => expect(sql).toContain(kind));
    expect(sql).toContain("'unassign','cancel_booking'");
    expect(sql).toContain("drop constraint hotel_physical_occupancy_requests_operation_kind_check");
    expect(sql).toContain("add constraint hotel_physical_occupancy_requests_operation_kind_check");
  });

  it("replaces only the unconditional occupancy uniqueness with active-only uniqueness", () => {
    expect(sql).toContain("drop constraint hotel_physical_occupancies_shared_room_group_id_key");
    expect(sql).toContain("create unique index hotel_physical_occupancies_active_shared_room_group_uidx on public.hotel_physical_occupancies(shared_room_group_id) where archived_at is null");
    expect(sql).not.toContain("shared_room_group_id=null");
    expect(sql).not.toContain("shared_room_group_id = null");
  });

  it("implements unassign as the atomic inverse while reusing the same capacity row", () => {
    const start = sql.indexOf("create function public.unassign_shared_hotel_room_before_check_in(");
    const end = sql.indexOf("create function public.cancel_shared_hotel_room_family_booking(");
    const unassign = sql.slice(start, end);
    expect(unassign).toContain("for update");
    expect(unassign).toContain("checked_in_at is not null");
    expect(unassign).toContain("checked_out_at is not null");
    expect(unassign).toContain("p_expected_version");
    expect(unassign).toContain("using errcode = 'pt409'");
    expect(unassign).toContain("update public.hotel_room_allocations");
    expect(unassign).toContain("update public.hotel_physical_occupancy_members");
    expect(unassign).toContain("update public.hotel_physical_occupancies");
    expect(unassign).toContain("update public.hotel_capacity_reservations");
    expect(unassign).toContain("source_kind = 'shared_group'");
    expect(unassign).toContain("physical_occupancy_id = null");
    expect(unassign).toContain("shared_room_group_id = shared_group.id");
    expect(unassign).toContain("update public.family_shared_room_groups target set status = 'requested'");
    expect(unassign).not.toContain("insert into public.hotel_capacity_reservations");
    expect(unassign).not.toContain("update public.hotel_stays");
    expect(unassign).not.toContain("update public.operation_schedules");
  });

  it("cancels only requested pre-check-in groups and preserves physical history", () => {
    const start = sql.indexOf("create function public.cancel_shared_hotel_room_family_booking(");
    const cancel = sql.slice(start);
    expect(cancel).toContain("shared_group.status <> 'requested'");
    expect(cancel).toContain("checked_in_at is not null");
    expect(cancel).toContain("checked_out_at is not null");
    expect(cancel).toContain("from public.hotel_physical_occupancies");
    expect(cancel).toContain("archived_at is null");
    expect(cancel).toContain("update public.hotel_capacity_reservations");
    expect(cancel).toContain("update public.hotel_stays");
    expect(cancel).toContain("update public.family_booking_members");
    expect(cancel).toContain("update public.family_shared_room_groups target set status = 'cancelled'");
    expect(cancel).toContain("public.set_operation_schedule_status");
    expect(cancel).not.toContain("delete from public.");
    expect(cancel).not.toContain("update public.hotel_physical_occupancies");
    expect(cancel).not.toContain("update public.hotel_physical_occupancy_members");
  });

  it("preserves authorization, idempotency, version and lock contracts", () => {
    expect((sql.match(/is_active_operation_member\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/claim_shared_hotel_request_internal\( p_request_id, 'unassign'/);
    expect(sql).toMatch(/claim_shared_hotel_request_internal\( p_request_id, 'cancel_booking'/);
    expect((sql.match(/finish_shared_hotel_request_internal/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((sql.match(/pg_advisory_xact_lock/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("security definer set search_path = public, pg_temp");
    expect(sql).toContain("revoke all on function public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid) from public, anon");
    expect(sql).toContain("grant execute on function public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid) to authenticated, service_role");
  });
});

describe("Shared Room reversal verification artifacts", () => {
  it.each(["preflight", "postflight"])("keeps %s read-only and rollback bounded", (name) => {
    const artifact = normalized(source(verificationPath(name)));
    expect(artifact).toMatch(/^-- .* begin transaction read only;/);
    expect(artifact.endsWith("rollback;")).toBe(true);
    expect(artifact).not.toMatch(/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b\s+(?:table|function|index|into|public\.)/);
  });

  it("verifies the partial index semantically and treats business counts as informational", () => {
    const postflight = normalized(source(verificationPath("postflight")));
    expect(postflight).toContain("from pg_index index_meta");
    expect(postflight).toContain("index_meta.indisunique");
    expect(postflight).toContain("pg_get_expr(index_meta.indpred, index_meta.indrelid)");
    expect(postflight).toContain("'informational_only'::text as business_counts");
    expect(postflight).toContain("duplicate_active_shared_capacity_count = 0");
    expect(postflight).toContain("orphan_active_occupancy_count = 0");
    expect(postflight).not.toMatch(/(?:historical_occupancy_count|archived_occupancy_count|requested_group_count|allocated_group_count)\s*=\s*\d/);
  });

  it.each(["preflight", "postflight"])(
    "evaluates the canonical current and completed lifecycle matrix in %s",
    (name) => {
      const artifact = source(verificationPath(name));
      const lifecyclePairs = extractLifecyclePairs(artifact);

      expect(lifecyclePairs).toEqual(new Set([
        "active:allocated",
        "completed:released",
      ]));
      expect(isCanonicalLifecycle(lifecyclePairs, "active", "allocated")).toBe(true);
      expect(isCanonicalLifecycle(lifecyclePairs, "completed", "released")).toBe(true);
      expect(isCanonicalLifecycle(lifecyclePairs, "active", "requested")).toBe(false);
      expect(isCanonicalLifecycle(lifecyclePairs, "active", "released")).toBe(false);
      expect(isCanonicalLifecycle(lifecyclePairs, "completed", "allocated")).toBe(false);
      expect(isCanonicalLifecycle(lifecyclePairs, "completed", "requested")).toBe(false);
      expect(isCanonicalLifecycle(lifecyclePairs, "released", "released")).toBe(false);
      expect(isCanonicalLifecycle(lifecyclePairs, "unknown", "allocated")).toBe(false);
    },
  );

  it("uses the exact same lifecycle count definition before and after migration", () => {
    expect(extractLifecycleCountDefinition(source(verificationPath("postflight"))))
      .toBe(extractLifecycleCountDefinition(source(verificationPath("preflight"))));
  });

  it.each(["preflight", "postflight"])(
    "accepts requested/current/completed history and rejects mismatched lifecycle fixtures in %s",
    (name) => {
      const pairs = extractLifecyclePairs(source(verificationPath(name)));

      const positiveFixtures = [
        { groups: [{ id: "requested", status: "requested" }], occupancies: [] },
        {
          groups: [{ id: "allocated", status: "allocated" }],
          occupancies: [{ groupId: "allocated", status: "active" }],
        },
        {
          groups: [{ id: "released", status: "released" }],
          occupancies: [{ groupId: "released", status: "completed" }],
        },
        {
          groups: [
            { id: "requested", status: "requested" },
            { id: "released", status: "released" },
          ],
          occupancies: [{ groupId: "released", status: "completed" }],
        },
      ];
      positiveFixtures.forEach((fixture) => {
        expect(validateLifecycleFixture(pairs, fixture.groups, fixture.occupancies)).toBe(true);
      });

      const negativeFixtures = [
        { groups: [{ id: "g", status: "requested" }], occupancies: [{ groupId: "g", status: "active" }] },
        { groups: [{ id: "g", status: "released" }], occupancies: [{ groupId: "g", status: "active" }] },
        { groups: [{ id: "g", status: "allocated" }], occupancies: [{ groupId: "g", status: "completed" }] },
        { groups: [{ id: "g", status: "requested" }], occupancies: [{ groupId: "g", status: "completed" }] },
        { groups: [{ id: "g", status: "allocated" }], occupancies: [] },
        { groups: [{ id: "g", status: "allocated" }], occupancies: [{ groupId: "g", status: "unknown" }] },
        { groups: [], occupancies: [{ groupId: "missing", status: "active" }] },
      ];
      negativeFixtures.forEach((fixture) => {
        expect(validateLifecycleFixture(pairs, fixture.groups, fixture.occupancies)).toBe(false);
      });
    },
  );

  it.each(["preflight", "postflight"])(
    "requires every allocated group to own a current active occupancy in %s",
    (name) => {
      const artifact = normalized(source(verificationPath(name)));
      const allocatedGuard = artifact.match(
        /room_group\.status = 'allocated' and not exists \(select 1 from public\.hotel_physical_occupancies occupancy where occupancy\.shared_room_group_id = room_group\.id and occupancy\.archived_at is null and occupancy\.status = '([^']+)'\)/,
      );
      expect(allocatedGuard?.[1]).toBe("active");
      expect(artifact).toContain("allocated_group_without_current_occupancy_count = 0");
    },
  );

  it("pins the exact old/new request kinds and all existing RPC signatures", () => {
    const preflight = normalized(source(verificationPath("preflight")));
    const postflight = normalized(source(verificationPath("postflight")));
    expect(preflight).toContain("exact_old_operation_kinds_ok");
    expect(postflight).toContain("exact_new_request_operation_kinds");
    [
      "create_flexible_hotel_reservation",
      "create_family_booking",
      "create_shared_room_family_booking",
      "create_unassigned_shared_room_family_booking",
      "create_shared_hotel_room_occupancy",
      "move_shared_hotel_room_occupancy",
      "join_shared_hotel_room_occupancy",
      "complete_shared_hotel_check_in",
      "complete_shared_hotel_member_check_out",
      "reverse_shared_hotel_member_completion",
    ].forEach((rpc) => {
      expect(preflight).toContain(`public.${rpc}`);
      expect(postflight).toContain(`public.${rpc}`);
    });
  });

  it("keeps runtime mutation QA isolated and covers the lifecycle and conflict scenarios", () => {
    const runtime = normalized(source(verificationPath("runtime_qa")));
    expect(runtime).toContain("select hotel_qa.assert_isolated_environment()");
    expect(runtime.endsWith("rollback;")).toBe(true);
    [
      "assign_unassign_requested_state",
      "same_request_replay",
      "request_payload_conflict",
      "archived_o1_reassign_o2",
      "assign_unassign_cancel",
      "requested_cancel",
      "allocated_direct_cancel_rejected",
      "version_conflict_rejected",
      "concurrent_second_unassign_rejected",
      "partial_checkin_rejected",
      "full_checkin_rejected",
      "invalid_allocation_rejected",
      "invalid_capacity_rejected",
      "non_deluxe_rejected",
      "cross_customer_rejected",
      "requested_with_active_occupancy_cancel_rejected",
    ].forEach((scenario) => expect(runtime).toContain(`'${scenario}'`));
  });
});
