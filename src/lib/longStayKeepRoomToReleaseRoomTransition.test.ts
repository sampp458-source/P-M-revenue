import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/202608140004_long_stay_keep_room_to_release_room_transition.sql";
const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(
  "supabase/verification/202608140004_long_stay_keep_room_to_release_room_transition_preflight.sql",
  "utf8",
);
const runtime = readFileSync(
  "supabase/verification/202608140004_long_stay_keep_room_to_release_room_transition_runtime_qa.sql",
  "utf8",
);
const postflight = readFileSync(
  "supabase/verification/202608140004_long_stay_keep_room_to_release_room_transition_postflight.sql",
  "utf8",
);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Long Stay KEEP_ROOM to RELEASE_ROOM transition", () => {
  it("derives inventory identities in the database and uses transaction time", () => {
    expect(migration).toContain("release_long_stay_room_during_absence");
    expect(migration).toContain("release_at_value timestamptz:=transaction_timestamp()");
    expect(migration).not.toMatch(/p_room_id|p_capacity_id|p_room_type_id|p_release_at/);
    expect(migration).toContain("leave_row.inventory_mode<>'keep_room'");
    expect(migration).toContain("leave_row.expected_return_date is null");
  });

  it("preserves old segments and creates one canonical future segment", () => {
    expect(migration).toContain("set allocated_until=release_at_value");
    expect(migration).toContain("set reserved_until=release_at_value");
    expect(migration).toContain("guarantee_from_value,'infinity'::timestamptz,1");
    expect(migration).toContain("runtime_capacity_reservation_id=future_capacity_id");
    expect(migration).toContain("inventory_mode='release_room'");
    expect(migration).toContain("inventory_transition_status='room_released'");
  });

  it("keeps authorization, lock, capacity, replay and stale guards", () => {
    expect(migration).toContain("is_active_operation_member()");
    expect(migration).toContain("for update");
    expect(migration).toContain("assert_hotel_total_capacity_available");
    expect(migration).toContain("assert_hotel_capacity_available");
    expect(migration).toContain("long_stay_replay_internal");
    expect(migration).toContain("using errcode='PT409'");
    expect(migration).toContain("assert_long_stay_runtime_invariant_internal(p_contract_id)");
  });

  it("verifies the U-style runtime matrix rollback-only", () => {
    for (const scenario of "ABCDEFGHIJKLMNOPQRSTU") {
      expect(runtime).toMatch(new RegExp(`'${scenario}_`));
    }
    expect(runtime.trimEnd().endsWith("rollback;")).toBe(true);
    expect(postflight).toContain("STOP_LONG_STAY_KEEP_TO_RELEASE_QA_RESIDUE");
  });

  it("builds exact Clean QA and Production Dashboard packages", () => {
    execFileSync(process.execPath, [
      "supabase/verification/build_202608140004_long_stay_keep_room_to_release_room_dashboard_sql.mjs",
    ]);
    const migrationSha = sha256(migration);
    for (const environment of ["clean-qa", "production"]) {
      const directory = `supabase/qa/long-stay-keep-to-release-${environment}`;
      const files = ["preflight", "migration", "postflight"].map((phase) =>
        readFileSync(`${directory}/long_stay_keep_to_release_dashboard_${phase}.sql`, "utf8"));
      files.forEach((artifact) => {
        expect(artifact).toContain(migrationSha);
        expect(artifact).toContain("zorvcuskzemehblqdbfj");
        expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      });
      expect(files[1]).toContain(`-- Embedded source SHA-256: ${migrationSha}`);
    }
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_KEEP_TO_RELEASE");
    expect(postflight).toContain("LONG_STAY_KEEP_TO_RELEASE_READY");
  });
});
