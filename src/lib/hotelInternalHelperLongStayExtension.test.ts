import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608070004_hotel_internal_helper_long_stay_extension.sql",
  "utf8",
);
const preflight = readFileSync(
  "supabase/verification/202608070004_hotel_internal_helper_long_stay_extension_preflight.sql",
  "utf8",
);
const postflight = readFileSync(
  "supabase/verification/202608070004_hotel_internal_helper_long_stay_extension_postflight.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/verification/202608070004_hotel_internal_helper_long_stay_extension_rollback.sql",
  "utf8",
);
const transactionQa = readFileSync(
  "supabase/verification/202608070004_hotel_internal_helper_long_stay_extension_transaction_qa.sql",
  "utf8",
);
const cleanQaAclPreflight = readFileSync(
  "supabase/qa/hotel-helper-long-stay-extension/10_clean_qa_frozen_acl_baseline_preflight.sql",
  "utf8",
);
const cleanQaAclRepair = readFileSync(
  "supabase/qa/hotel-helper-long-stay-extension/11_clean_qa_frozen_acl_baseline_repair.sql",
  "utf8",
);
const cleanQaAclPostflight = readFileSync(
  "supabase/qa/hotel-helper-long-stay-extension/12_clean_qa_frozen_acl_baseline_postflight.sql",
  "utf8",
);
const cleanQaAclRollback = readFileSync(
  "supabase/qa/hotel-helper-long-stay-extension/13_clean_qa_frozen_acl_baseline_rollback.sql",
  "utf8",
);

const publicRpcs = [
  "create_flexible_hotel_reservation",
  "change_room_type_before_check_in",
  "change_room_type_after_check_in",
];

const compatibilityHelpers = [
  "prepare_hotel_reservation_runtime_input_internal",
  "create_hotel_reservation_runtime_internal",
  "change_hotel_room_type_and_allocation_internal",
];

const extendedHelpers = [
  "prepare_hotel_reservation_runtime_input_extended_internal",
  "create_hotel_reservation_runtime_extended_internal",
  "change_hotel_room_type_and_allocation_extended_internal",
];

function migrationBodyFingerprint(functionName: string) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(
      `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${escaped}\\([\\s\\S]*?\\n(?:as\\s+)?\\$\\$([\\s\\S]*?)\\$\\$;`,
      "i",
    ),
  );
  if (!match) throw new Error(`Missing function body: ${functionName}`);
  return createHash("md5").update(match[1]).digest("hex");
}

describe("Hotel Internal Helper Long Stay Extension package", () => {
  it("does not redefine any public Hotel RPC", () => {
    for (const rpc of publicRpcs) {
      expect(migration).not.toMatch(
        new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${rpc}\\s*\\(`, "i"),
      );
    }
  });

  it("changes exactly the three existing compatibility helpers", () => {
    const definitions = compatibilityHelpers.filter((name) =>
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i").test(migration),
    );
    expect(definitions).toEqual(compatibilityHelpers);
  });

  it("adds exactly three postgres-only extended helpers", () => {
    for (const helper of extendedHelpers) {
      expect(migration).toMatch(
        new RegExp(`create\\s+function\\s+public\\.${helper}\\s*\\(`, "i"),
      );
      expect(migration).toMatch(
        new RegExp(`revoke all on function public\\.${helper}[\\s\\S]*?from public, anon, authenticated, service_role`, "i"),
      );
    }
    expect((migration.match(/_extended_internal\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });

  it("pins every compatibility and extended helper body fingerprint", () => {
    for (const helper of [...compatibilityHelpers, ...extendedHelpers]) {
      expect(postflight).toContain(migrationBodyFingerprint(helper));
    }
  });

  it("keeps ordinary Hotel defaults explicit in thin wrappers", () => {
    expect(migration).toMatch(
      /prepare_hotel_reservation_runtime_input_extended_internal[\s\S]*?true, null, p_room_type_id/i,
    );
    expect(migration).toMatch(
      /jsonb_build_object\('includeCheckOutEvent', true\), true/i,
    );
    expect(migration).toMatch(
      /array\['check_in', 'check_out'\]::text\[\]/i,
    );
  });

  it("supports an explicit optional checkout event without inferring from null", () => {
    expect(migration).toContain("p_include_check_out_event boolean");
    expect(migration).toContain("p_capacity_until_override timestamptz");
    expect(migration).toContain("'checkOutScheduleAt', check_out_schedule_at");
    expect(migration).toMatch(/'checkOutTitle', case when include_check_out[\s\S]*?else null end/i);
    expect(migration).toMatch(/if include_check_out then[\s\S]*?create_operation_schedule/i);
    expect(migration).toMatch(/if include_check_out then[\s\S]*?insert into public\.hotel_stay_schedule_events/i);
  });

  it("validates event-kind cardinality instead of only total schedule count", () => {
    expect(migration).toContain("p_required_event_kinds text[]");
    expect(migration).toContain("cardinality_check.event_count <> 1");
    expect(migration).toContain("not (event.event_kind = any(p_required_event_kinds))");
    expect(migration).toContain("for update of schedule");
  });

  it("does not create Long Stay runtime, trigger, snapshot, or infinity behavior", () => {
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toMatch(/create\s+(?:constraint\s+)?trigger/i);
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.[a-z0-9_]*long_stay/i);
    expect(migration).not.toContain("timestamptz 'infinity'");
    expect(migration).not.toMatch(/get_hotel_operations_snapshot_v2\s*\([^)]*\)\s*returns/i);
  });

  it("uses read-only preflight and postflight with fixed statuses", () => {
    expect(preflight).toMatch(/begin read only;/i);
    expect(preflight).toContain("READY_TO_APPLY_HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION");
    expect(preflight.trimEnd()).toMatch(/rollback;$/i);
    expect(postflight).toMatch(/begin read only;/i);
    expect(postflight).toContain("HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_READY");
    expect(postflight.trimEnd()).toMatch(/rollback;$/i);
  });

  it("validates each frozen function metadata contract independently", () => {
    expect(preflight).toContain("expected_volatility");
    expect(preflight).toContain("definition_fingerprint");
    expect(preflight).toMatch(
      /get_hotel_operations_snapshot_v2\(date\)'[^\n]*'s', 'jsonb'/i,
    );
    expect(preflight).toMatch(
      /provolatile = targets\.expected_volatility/i,
    );
    expect(migration).toMatch(
      /provolatile = expected\.expected_volatility/i,
    );
    expect(postflight).toMatch(
      /provolatile = public_target\.expected_volatility/i,
    );
  });

  it("ships a Clean-QA-only two-function ACL baseline repair", () => {
    for (const sql of [cleanQaAclPreflight, cleanQaAclRepair, cleanQaAclPostflight, cleanQaAclRollback]) {
      expect(sql).toContain("hotel_qa.assert_isolated_environment()");
      expect(sql).toContain("wxbvwixoeczfvbqurdse");
      expect(sql).toContain("zorvcuskzemehblqdbfj");
      expect(sql).toContain("reverse_hotel_completion");
      expect(sql).toContain("get_hotel_operations_snapshot_v2");
    }
    expect(cleanQaAclRepair).toMatch(
      /grant execute on function public\.reverse_hotel_completion[\s\S]*?to service_role/i,
    );
    expect(cleanQaAclRepair).toMatch(
      /grant execute on function public\.get_hotel_operations_snapshot_v2[\s\S]*?to service_role/i,
    );
    expect(cleanQaAclRepair).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i);
    expect(cleanQaAclRollback).toMatch(
      /revoke execute on function public\.reverse_hotel_completion[\s\S]*?from service_role/i,
    );
    expect(cleanQaAclRollback).toMatch(
      /revoke execute on function public\.get_hotel_operations_snapshot_v2[\s\S]*?from service_role/i,
    );
  });

  it("restores all original helper bodies and removes only extended helpers", () => {
    for (const helper of compatibilityHelpers) {
      expect(rollback).toMatch(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${helper}\\s*\\(`, "i"),
      );
    }
    for (const helper of extendedHelpers) {
      expect(rollback).toMatch(
        new RegExp(`drop\\s+function\\s+public\\.${helper}\\s*\\(`, "i"),
      );
    }
    expect(rollback).toContain("STOP_LONG_STAY_RUNTIME_MUST_BE_ROLLED_BACK_FIRST");
  });

  it("ships rollback-only extension fixtures for optional and required events", () => {
    expect(transactionQa).toContain("hotel_qa.assert_isolated_environment()");
    expect(transactionQa).toContain("checkout_excluded_graph");
    expect(transactionQa).toContain("checkout_included_graph");
    expect(transactionQa).toContain("check_in_only_cross_type");
    expect(transactionQa).toContain("required_event_missing");
    expect(transactionQa).toContain("duplicate_required_event_rejected");
    expect(transactionQa).toContain("archived_required_event_rejected");
    expect(transactionQa).toContain("failed_call_mutation_free");
    expect(transactionQa).toContain(
      "HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_TRANSACTION_QA_READY",
    );
    expect(transactionQa.trimEnd()).toMatch(/rollback;$/i);
  });
});
