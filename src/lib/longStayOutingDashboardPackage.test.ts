import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const base = "supabase/qa/long-stay-outing";
const migration = read("supabase/migrations/202608140002_long_stay_outing_expected_return.sql");
const preflight = read(`${base}/long_stay_outing_dashboard_preflight.sql`);
const dashboardMigration = read(`${base}/long_stay_outing_dashboard_migration.sql`);
const runtime = read(`${base}/long_stay_outing_dashboard_runtime_qa.sql`);
const postflight = read(`${base}/long_stay_outing_dashboard_postflight_cleanup.sql`);
const productionBase = "supabase/qa/long-stay-outing-production";
const productionPreflight = read(`${productionBase}/long_stay_outing_production_dashboard_preflight.sql`);
const productionMigration = read(`${productionBase}/long_stay_outing_production_dashboard_migration.sql`);
const productionPostflight = read(`${productionBase}/long_stay_outing_production_dashboard_postflight.sql`);

describe("Long Stay outing Clean QA Dashboard package", () => {
  it("pins the approved migration body and exact Clean QA target", () => {
    expect(sha(migration)).toBe("5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6");
    [preflight, dashboardMigration, runtime, postflight].forEach((artifact) => {
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_CLEAN_QA_DASHBOARD_BINDING");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_CLEAN_QA_ENVIRONMENT");
      expect(artifact).toContain("hotel_qa.assert_isolated_environment()");
      expect(artifact).toContain("5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6");
    });
  });

  it("embeds the exact migration source without editing its body", () => {
    expect(dashboardMigration).toContain(`-- Embedded source SHA-256: ${sha(migration)}`);
    expect(dashboardMigration).toContain("begin;");
    expect(dashboardMigration).toContain("commit;");
    const withoutHeader = dashboardMigration.slice(dashboardMigration.indexOf("-- Long Stay outing lifecycle repair"));
    const reconstructed = withoutHeader.replace(/\n-- DASHBOARD_BINDING_BEGIN[\s\S]*?-- DASHBOARD_BINDING_END\n/, "");
    expect(reconstructed).toBe(migration);
  });

  it("keeps the four Dashboard phases independent and fail-closed", () => {
    [preflight, dashboardMigration, runtime, postflight].forEach((artifact) => {
      expect(artifact).not.toContain("\\set ON_ERROR_STOP");
    });
    expect(preflight).toContain("begin read only;");
    expect(preflight).toContain("READY_TO_APPLY_LONG_STAY_OUTING_REPAIR");
    expect(runtime).toContain("LONG_STAY_OUTING_EXPECTED_RETURN_RUNTIME_QA_READY");
    expect(runtime).toContain("rollback;");
    expect(postflight).toContain("begin read only;");
    expect(postflight).toContain("LONG_STAY_OUTING_REPAIR_READY");
    expect(postflight).toContain("STOP_LONG_STAY_OUTING_RUNTIME_QA_RESIDUE");
  });

  it("retains A-M and the generic Hotel check-in pending-contract regression", () => {
    ["A_exact", "B_time_unknown", "C_date_unknown", "D_duplicate_rejected", "E_stale_pt409", "F_replay", "G_return_in_house", "H_second_outing", "I_allocation_preserved", "J_capacity_preserved", "K_actual_return_later", "L_actual_return_earlier", "M_legacy_read"]
      .forEach((name) => expect(runtime).toContain(`'${name}'`));
    expect(runtime).toContain("production_path_pending_after_generic_checkin");
    expect(runtime).toContain("perform public.complete_hotel_check_in");
    expect(runtime).toContain("count(*)=15");
  });

  it("never turns runtime rollback cleanup into destructive ledger deletion", () => {
    expect(runtime).not.toMatch(/delete\s+from\s+public\.(long_stay_operation_audit_events|operation_schedule_audit_events)/i);
    expect(postflight).not.toMatch(/^\s*(delete|update|insert|alter|create|drop|grant|revoke)\b/im);
  });
});

describe("Long Stay outing Production Dashboard package", () => {
  it("hard-binds Production, rejects Clean QA, and pins the approved migration", () => {
    [productionPreflight, productionMigration, productionPostflight].forEach((artifact) => {
      expect(artifact).toContain("zorvcuskzemehblqdbfj");
      expect(artifact).toContain("wxbvwixoeczfvbqurdse");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_PRODUCTION_DASHBOARD_BINDING");
      expect(artifact).toContain("5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6");
      expect(artifact).not.toContain("hotel_qa.assert_isolated_environment()");
    });
  });

  it("embeds the approved migration body without modification", () => {
    expect(productionMigration).toContain(`-- Embedded source SHA-256: ${sha(migration)}`);
    const withoutHeader = productionMigration.slice(productionMigration.indexOf("-- Long Stay outing lifecycle repair"));
    const reconstructed = withoutHeader.replace(/\n-- PRODUCTION_DASHBOARD_BINDING_BEGIN[\s\S]*?-- PRODUCTION_DASHBOARD_BINDING_END\n/, "");
    expect(reconstructed).toBe(migration);
  });

  it("keeps preflight and postflight read-only with existing-domain gates", () => {
    [productionPreflight, productionPostflight].forEach((artifact) => {
      expect(artifact).toContain("begin read only;");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_SHARED_ROOM_BASELINE");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_DAYCARE_BASELINE");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_FINANCE_BASELINE");
      expect(artifact).toContain("STOP_LONG_STAY_OUTING_HOTEL_CALENDAR_ROOM_BOARD_BASELINE");
    });
    expect(productionPreflight).toContain("READY_TO_APPLY_LONG_STAY_OUTING_REPAIR");
    expect(productionPostflight).toContain("LONG_STAY_OUTING_REPAIR_READY");
  });
});
