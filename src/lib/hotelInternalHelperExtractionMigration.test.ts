import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608070003_hotel_internal_helper_extraction.sql",
    import.meta.url,
  ),
  "utf8",
);
const preflight = readFileSync(
  new URL(
    "../../supabase/verification/202608070003_hotel_internal_helper_extraction_preflight.sql",
    import.meta.url,
  ),
  "utf8",
);
const postflight = readFileSync(
  new URL(
    "../../supabase/verification/202608070003_hotel_internal_helper_extraction_postflight.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../../supabase/verification/202608070003_hotel_internal_helper_extraction_rollback.sql",
    import.meta.url,
  ),
  "utf8",
);

const count = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length;

describe("Hotel internal helper extraction package", () => {
  it("changes exactly the three approved public definitions", () => {
    expect(
      count(migration, /^create or replace function public\./gim),
    ).toBe(4);
    // The fourth CREATE OR REPLACE completes the forward-declared internal
    // runtime helper; only these three public names may be replaced.
    const publicReplacements = [
      ...migration.matchAll(
        /^create or replace function public\.([a-z0-9_]+)\(/gim,
      ),
    ]
      .map((match) => match[1])
      .filter((name) => !name.endsWith("_internal"));
    expect(publicReplacements).toEqual([
      "create_flexible_hotel_reservation",
      "change_room_type_before_check_in",
      "change_room_type_after_check_in",
    ]);
  });

  it("adds exactly the approved helper identities and postgres-only ACL", () => {
    for (const helper of [
      "prepare_hotel_reservation_runtime_input_internal",
      "create_hotel_reservation_runtime_internal",
      "change_hotel_room_type_and_allocation_internal",
    ]) {
      expect(migration).toContain(`function public.${helper}(`);
      expect(postflight).toContain(`public.${helper}(`);
      expect(rollback).toContain(`drop function public.${helper}(`);
    }
    expect(
      count(
        migration,
        /from public, anon, authenticated, service_role;/g,
      ),
    ).toBe(3);
    expect(postflight).toContain("array['postgres']::text[]");
  });

  it("preserves the approved service_role ACL on all public wrappers", () => {
    expect(preflight).toContain(
      "array['authenticated', 'postgres', 'service_role']::text[]",
    );
    expect(postflight).toContain(
      "array['authenticated', 'postgres', 'service_role']::text[]",
    );
    expect(count(migration, /to authenticated, service_role;/g)).toBe(3);
    expect(count(rollback, /to authenticated, service_role;/g)).toBe(3);

    for (const publicFunction of [
      "create_flexible_hotel_reservation",
      "change_room_type_before_check_in",
      "change_room_type_after_check_in",
    ]) {
      const aclStart = migration.indexOf(
        `revoke all on function public.${publicFunction}(`,
      );
      const aclEnd = migration.indexOf(";", aclStart);
      expect(migration.slice(aclStart, aclEnd)).toContain("from public, anon");
      expect(migration.slice(aclStart, aclEnd)).not.toContain("service_role");
    }
  });

  it("keeps permission, replay, lock, audit and return contracts in wrappers", () => {
    expect(migration).toContain("not public.is_active_operation_member()");
    expect(migration).toContain(
      "not public.has_operation_role(array['owner', 'manager'])",
    );
    expect(count(migration, /hotel-request:/g)).toBeGreaterThanOrEqual(3);
    expect(migration).toContain(
      "동일 request_id의 입력 계약이 일치하지 않습니다.",
    );
    expect(migration).toContain("동일 request_id의 입력 계약 불일치");
    expect(migration).toContain("Hotel Stay Root Audit이 정확히 한 건");
    expect(migration).toContain("return public.hotel_stay_json");
  });

  it("keeps the global type-room-total ordering inside the mutation helper", () => {
    const typeLock = migration.indexOf("'hotel-capacity:' || lock_id::text");
    const roomLock = migration.indexOf("'hotel-room:' || lock_id::text");
    const capacityUpdate = migration.indexOf(
      "update public.hotel_capacity_reservations capacity",
    );
    expect(typeLock).toBeGreaterThan(0);
    expect(roomLock).toBeGreaterThan(typeLock);
    expect(capacityUpdate).toBeGreaterThan(roomLock);
  });

  it("does not introduce frozen or Long Stay runtime changes", () => {
    expect(migration).not.toMatch(
      /create or replace function public\.(complete_hotel_check_out|reverse_hotel_completion|get_hotel_operations_snapshot_v2)\(/i,
    );
    expect(migration).not.toMatch(/create\s+(table|trigger).*long[_ ]stay/i);
    expect(migration).not.toContain("timestamptz 'infinity'");
    expect(postflight).toContain("forbidden_runtime_contract_absent");
  });

  it("guards before, after and rollback fingerprints", () => {
    expect(preflight).toContain(
      "READY_TO_APPLY_HOTEL_INTERNAL_HELPER_EXTRACTION",
    );
    expect(postflight).toContain("HOTEL_INTERNAL_HELPER_EXTRACTION_READY");
    expect(rollback).toContain("cad788cb79875fab06f0d84470da4698");
    expect(rollback).toContain("39c760d45df40a92cb3b82ceea8a48ea");
    expect(rollback).toContain("7b2a2f0b1c24a3a6d92ac37d400c97d7");
    for (const contractFile of [preflight, migration, postflight, rollback]) {
      expect(contractFile).toContain("7744baa7276dcb70676ec593e8ddc0e6");
      expect(contractFile).not.toContain("2cdbabd36b980112dd8ae4c46f40c838");
    }
  });
});
