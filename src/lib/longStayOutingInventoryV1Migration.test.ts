import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608140003_long_stay_outing_inventory_v1.sql",
  "utf8",
);
const runtime = readFileSync(
  "supabase/verification/202608140003_long_stay_outing_inventory_v1_runtime_qa.sql",
  "utf8",
);
const postflight = readFileSync(
  "supabase/verification/202608140003_long_stay_outing_inventory_v1_postflight.sql",
  "utf8",
);
const migrationSha = "6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Long Stay Outing Inventory V1 migration", () => {
  it("adds two explicit inventory modes without a new domain table", () => {
    expect(migration).toContain("inventory_mode text not null default 'keep_room'");
    expect(migration).toContain("inventory_mode in ('keep_room','release_room')");
    expect(migration).not.toMatch(/create table public\.long_stay_outing/i);
    expect(migration).toContain("add column released_allocation_id");
    expect(migration).toContain("add column return_capacity_id");
  });

  it("keeps historical segments and creates future type capacity", () => {
    expect(migration).toContain("set allocated_until=p_left_at");
    expect(migration).toContain("set reserved_until=p_left_at");
    expect(migration).toContain("guarantee_from_value,'infinity'::timestamptz");
    expect(migration).toContain("insert into public.hotel_capacity_reservations");
    expect(migration).not.toContain("set reserved_from=guarantee_from_value");
  });

  it("uses date-only midnight only for the capacity guarantee", () => {
    expect(migration).toContain(
      "guarantee_from_value:=p_expected_return_date::timestamp at time zone 'Asia/Seoul'",
    );
    expect(migration).toContain("expected_return_at_value:=null");
    expect(migration).toContain("객실 임시 해제에는 예상 복귀 날짜가 필요합니다.");
  });

  it("requires an operator-selected same-type room on released return", () => {
    expect(migration).toContain("get_long_stay_return_room_availability");
    expect(migration).toContain("복귀할 객실을 선택해 주세요.");
    expect(migration).toContain("room_row.room_type_id<>capacity_row.room_type_id");
    expect(migration).toContain("assert_hotel_room_allocation_available");
    expect(migration).toContain("p_returned_at<capacity_row.reserved_from");
  });

  it("moves an expected-return boundary atomically and preserves stale/replay guards", () => {
    expect(migration).toContain("set_long_stay_absence_expected_return_v2");
    expect(migration).toContain("assert_hotel_total_capacity_available(boundary");
    expect(migration).toContain("using errcode='PT409'");
    expect(migration).toContain("long_stay_replay_internal");
  });

  it("models released outing separately in the deferred invariant", () => {
    expect(migration).toContain("LONG_STAY_OUTING_RELEASED_INVARIANT_VIOLATION");
    expect(migration).toContain("allocation_count<>0");
    expect(migration).toContain("capacity_row.id is distinct from leave_row.return_capacity_id");
  });

  it("blocks every Hotel checkout path until a released outing has returned", () => {
    expect(migration).toContain("guard_long_stay_outing_released_checkout");
    expect(migration).toContain("long_stay_outing_released_checkout_guard");
    expect(migration).toContain("먼저 복귀 처리 후 퇴실해 주세요");
  });

  it("keeps the A-Y runtime matrix rollback-only and verifies Z residue separately", () => {
    for (const scenario of "ABCDEFGHIJKLMNOPQRSTUVWXY") {
      expect(runtime).toMatch(new RegExp(`'${scenario}_`));
    }
    expect(runtime.trimEnd().endsWith("rollback;")).toBe(true);
    expect(postflight).toContain("STOP_LONG_STAY_OUTING_INVENTORY_QA_RESIDUE");
  });

  it("builds exact, production-bound Dashboard release artifacts", () => {
    expect(sha256(migration)).toBe(migrationSha);
    execFileSync(
      process.execPath,
      ["supabase/verification/build_202608140003_long_stay_outing_inventory_production_dashboard_sql.mjs"],
    );
    const directory = "supabase/qa/long-stay-outing-inventory-production";
    const preflight = readFileSync(`${directory}/long_stay_outing_inventory_production_dashboard_preflight.sql`, "utf8");
    const migrationPackage = readFileSync(`${directory}/long_stay_outing_inventory_production_dashboard_migration.sql`, "utf8");
    const productionPostflight = readFileSync(`${directory}/long_stay_outing_inventory_production_dashboard_postflight.sql`, "utf8");
    for (const artifact of [preflight, migrationPackage, productionPostflight]) {
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain(migrationSha);
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_INVENTORY_PRODUCTION_DASHBOARD_BINDING");
      expect(artifact).not.toContain("hotel_qa.assert_isolated_environment");
    }
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_OUTING_INVENTORY_V1");
    expect(migrationPackage).toContain(`-- Embedded source SHA-256: ${migrationSha}`);
    expect(migrationPackage).toContain("create function public.start_long_stay_absence_v3");
    expect(migrationPackage).toContain("create function public.complete_long_stay_absence_v2");
    expect(migrationPackage.trimEnd().endsWith("commit;")).toBe(true);
    expect(productionPostflight).toContain("LONG_STAY_OUTING_INVENTORY_V1_READY");
    expect(preflight).toContain("begin read only;");
    expect(productionPostflight).toContain("begin read only;");
  });
});
