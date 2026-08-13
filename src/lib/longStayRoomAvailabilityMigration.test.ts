import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/202608130002_long_stay_room_availability.sql");
const preflight = read("supabase/verification/202608130002_long_stay_room_availability_preflight.sql");
const postflight = read("supabase/verification/202608130002_long_stay_room_availability_postflight.sql");
const runtimeQa = read("supabase/verification/202608130002_long_stay_room_availability_runtime_qa.sql");

describe("Long Stay room availability read contract", () => {
  it("adds one read-only RPC without changing the final room conflict guard", () => {
    expect(migration).toContain("create function public.get_long_stay_room_availability(");
    expect(migration).toContain("language plpgsql\nstable\nsecurity definer");
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function\s+public\.confirm_long_stay_month/i);
    expect(postflight).toContain("STOP_LONG_STAY_ROOM_CONFLICT_GUARD_CHANGED");
    expect(postflight).toContain("errcode = ''23P01''");
    expect(postflight).toContain("allocation.allocated_until > p_allocated_from");
  });

  it("matches the allocation invariant interval and ignores archived or past rows", () => {
    expect(migration).toContain("allocation.archived_at is null");
    expect(migration).toContain("allocation.allocated_until>availability_from");
    expect(migration).toContain("allocation.id is distinct from exclude_allocation_id");
    expect(migration).toContain("'isOpenEnded',true");
    expect(migration).toContain("then null else conflict.allocated_until");
  });

  it("classifies ordinary Hotel, Shared Room and Long Stay conflicts", () => {
    expect(migration).toContain("then 'shared_room'");
    expect(migration).toContain("then 'long_stay'");
    expect(migration).toContain("when capacity.source_kind='stay' then 'hotel'");
    expect(migration).toContain("then 'future'");
    expect(migration).toContain("else 'past_overlap'");
  });

  it("keeps access scoped to active Operations members", () => {
    expect(migration).toContain("public.is_active_operation_member()");
    expect(migration).toContain("from public,anon");
    expect(migration).toContain("to authenticated,service_role");
    expect(postflight).toContain("array['authenticated','postgres','service_role']");
  });

  it("provides fail-closed preflight and postflight gates", () => {
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_ROOM_AVAILABILITY");
    expect(postflight).toContain("LONG_STAY_ROOM_AVAILABILITY_READY");
    expect(preflight).toContain("begin read only;");
    expect(postflight).toContain("begin read only;");
  });

  it("keeps the runtime matrix rollback-only and covers each allocation source", () => {
    expect(runtimeQa).toContain("select hotel_qa.assert_isolated_environment()");
    expect(runtimeQa).toContain("rollback;");
    expect(runtimeQa).toContain("STOP_CURRENT_OCCUPIED");
    expect(runtimeQa).toContain("STOP_FUTURE_CONFLICT");
    expect(runtimeQa).toContain("STOP_ARCHIVED_OR_PAST_FINITE");
    expect(runtimeQa).toContain("STOP_SHARED_ROOM_CONFLICT");
    expect(runtimeQa).toContain("STOP_LONG_STAY_CONFLICT");
    expect(runtimeQa).toContain("LONG_STAY_ROOM_AVAILABILITY_QA_RESIDUE_ZERO");
  });
});
